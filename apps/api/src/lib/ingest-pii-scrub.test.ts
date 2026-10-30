import { afterEach, describe, expect, it } from "vitest";
import { computeFingerprint } from "../services/errors.js";
import {
  isIngestPiiScrubEnabled,
  resolveIngestPiiScrubOptions,
  scrubIngestErrorFields,
  scrubIngestEventFields,
  scrubIngestSessionUserEmail,
} from "./ingest-pii-scrub.js";

describe("isIngestPiiScrubEnabled", () => {
  it("defaults to enabled", () => {
    expect(isIngestPiiScrubEnabled({})).toBe(true);
  });

  it("can be disabled via env", () => {
    expect(isIngestPiiScrubEnabled({ TELEMETRY_INGEST_PII_SCRUB: "false" })).toBe(
      false
    );
    expect(isIngestPiiScrubEnabled({ TELEMETRY_INGEST_PII_SCRUB: "off" })).toBe(
      false
    );
  });
});

describe("resolveIngestPiiScrubOptions", () => {
  it("parses depth and node limits", () => {
    expect(
      resolveIngestPiiScrubOptions({
        TELEMETRY_INGEST_PII_SCRUB_MAX_DEPTH: "4",
        TELEMETRY_INGEST_PII_SCRUB_MAX_NODES: "50",
      })
    ).toEqual({ maxDepth: 4, maxNodes: 50 });
  });
});

describe("scrubIngestErrorFields", () => {
  const prev = process.env.TELEMETRY_INGEST_PII_SCRUB;

  afterEach(() => {
    if (prev === undefined) delete process.env.TELEMETRY_INGEST_PII_SCRUB;
    else process.env.TELEMETRY_INGEST_PII_SCRUB = prev;
  });

  it("scrubs message, stack, and context before storage", () => {
    const scrubbed = scrubIngestErrorFields(
      {
        message: "boom for user@example.com",
        stack: "Error: user@example.com\n    at run",
        context: { Email: "a@b.co", detail: "token=abc" },
      },
      {}
    );
    expect(scrubbed.message).toBe("boom for [email]");
    expect(scrubbed.stack).toBe("Error: [email]\n    at run");
    expect(scrubbed.context).toEqual({
      Email: "[email]",
      detail: "token=[redacted]",
    });
  });

  it("scrubs before fingerprint so raw emails do not affect grouping", () => {
    const a = scrubIngestErrorFields(
      {
        message: "boom for alice@example.com",
        stack: "Error: alice@example.com\n    at run",
      },
      {}
    );
    const b = scrubIngestErrorFields(
      {
        message: "boom for bob@example.com",
        stack: "Error: bob@example.com\n    at run",
      },
      {}
    );
    expect(computeFingerprint(a.message, a.stack)).toBe(
      computeFingerprint(b.message, b.stack)
    );
    expect(computeFingerprint(a.message, a.stack)).not.toContain("@");
  });

  it("is a no-op when scrubbing is disabled", () => {
    const body = {
      message: "user@example.com",
      context: { email: "a@b.co" },
    };
    expect(
      scrubIngestErrorFields(body, { TELEMETRY_INGEST_PII_SCRUB: "false" })
    ).toEqual(body);
  });

  it("truncates message and stack before scrubbing to bound cost", () => {
    const longMessage = "Error: ".repeat(10_000);
    const longStack = "at frame\n".repeat(10_000);
    const scrubbed = scrubIngestErrorFields(
      { message: longMessage, stack: longStack },
      {}
    );
    expect(Buffer.byteLength(scrubbed.message, "utf8")).toBeLessThanOrEqual(16 * 1024);
    expect(Buffer.byteLength(scrubbed.stack!, "utf8")).toBeLessThanOrEqual(16 * 1024);
  });

  it("scrubs large message within time bound after truncation", () => {
    const largeMessage = "1-".repeat(100_000);
    const start = performance.now();
    const scrubbed = scrubIngestErrorFields({ message: largeMessage }, {});
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
    expect(scrubbed.message).toBeTruthy();
    expect(Buffer.byteLength(scrubbed.message, "utf8")).toBeLessThanOrEqual(16 * 1024);
  });

  it("scrubs large stack within time bound after truncation", () => {
    const largeStack = "a.".repeat(100_000) + "@test\n  at frame";
    const start = performance.now();
    const scrubbed = scrubIngestErrorFields(
      { message: "Error", stack: largeStack },
      {}
    );
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
    expect(scrubbed.stack).toBeTruthy();
    expect(Buffer.byteLength(scrubbed.stack!, "utf8")).toBeLessThanOrEqual(16 * 1024);
  });

  it("truncates deeply nested context strings with scrubbing enabled", () => {
    const largeString = "x".repeat(20_000);
    let nested: Record<string, unknown> = { value: largeString };
    for (let i = 0; i < 11; i++) {
      nested = { level: nested };
    }
    const scrubbed = scrubIngestErrorFields(
      { message: "Error", context: nested },
      {}
    );
    expect(scrubbed.context).toBeTruthy();
    const extractValue = (obj: unknown, depth: number): string | null => {
      if (depth === 0 && obj && typeof obj === "object" && "value" in obj) {
        return obj.value as string;
      }
      if (obj && typeof obj === "object" && "level" in obj) {
        return extractValue(obj.level, depth - 1);
      }
      return null;
    };
    const value = extractValue(scrubbed.context, 11);
    expect(value).toBeTruthy();
    expect(Buffer.byteLength(value!, "utf8")).toBeLessThanOrEqual(16 * 1024);
  });

  it("truncates deeply nested context strings with scrubbing disabled", () => {
    const largeString = "x".repeat(20_000);
    let nested: Record<string, unknown> = { value: largeString };
    for (let i = 0; i < 11; i++) {
      nested = { level: nested };
    }
    const scrubbed = scrubIngestErrorFields(
      { message: "Error", context: nested },
      { TELEMETRY_INGEST_PII_SCRUB: "false" }
    );
    expect(scrubbed.context).toBeTruthy();
    const extractValue = (obj: unknown, depth: number): string | null => {
      if (depth === 0 && obj && typeof obj === "object" && "value" in obj) {
        return obj.value as string;
      }
      if (obj && typeof obj === "object" && "level" in obj) {
        return extractValue(obj.level, depth - 1);
      }
      return null;
    };
    const value = extractValue(scrubbed.context, 11);
    expect(value).toBeTruthy();
    expect(Buffer.byteLength(value!, "utf8")).toBeLessThanOrEqual(16 * 1024);
  });
});

describe("scrubIngestEventFields", () => {
  it("scrubs nested properties (shared by /event and /batch)", () => {
    expect(
      scrubIngestEventFields(
        {
          properties: {
            email: "user@example.com",
            meta: { note: "Bearer abc.def" },
          },
        },
        {}
      )
    ).toEqual({
      properties: {
        email: "[email]",
        meta: { note: "[bearer-token]" },
      },
    });
  });

  it("merges project denyKeys into property scrubbing", () => {
    expect(
      scrubIngestEventFields(
        { properties: { nationalId: "X-99", path: "/ok" } },
        {},
        { denyKeys: ["nationalId"] }
      )
    ).toEqual({
      properties: { nationalId: "[redacted]", path: "/ok" },
    });
  });

  it("leaves events without properties unchanged", () => {
    const body = { name: "checkout_started" };
    expect(scrubIngestEventFields(body, {})).toEqual(body);
  });

  it("truncates string property values before scrubbing", () => {
    const longValue = "x".repeat(20_000);
    const scrubbed = scrubIngestEventFields(
      { properties: { note: longValue } },
      {}
    );
    expect(
      Buffer.byteLength(scrubbed.properties!.note as string, "utf8")
    ).toBeLessThanOrEqual(16 * 1024);
  });

  it("scrubs large properties within time bound after truncation", () => {
    const largeData = "1-".repeat(100_000);
    const start = performance.now();
    const scrubbed = scrubIngestEventFields(
      { properties: { data: largeData } },
      {}
    );
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
    expect(scrubbed.properties).toBeTruthy();
  });

  it("truncates deeply nested property strings with scrubbing enabled", () => {
    const largeString = "x".repeat(20_000);
    let nested: Record<string, unknown> = { value: largeString };
    for (let i = 0; i < 11; i++) {
      nested = { level: nested };
    }
    const scrubbed = scrubIngestEventFields(
      { properties: nested },
      {}
    );
    expect(scrubbed.properties).toBeTruthy();
    const extractValue = (obj: unknown, depth: number): string | null => {
      if (depth === 0 && obj && typeof obj === "object" && "value" in obj) {
        return obj.value as string;
      }
      if (obj && typeof obj === "object" && "level" in obj) {
        return extractValue(obj.level, depth - 1);
      }
      return null;
    };
    const value = extractValue(scrubbed.properties, 11);
    expect(value).toBeTruthy();
    expect(Buffer.byteLength(value!, "utf8")).toBeLessThanOrEqual(16 * 1024);
  });

  it("truncates deeply nested property strings with scrubbing disabled", () => {
    const largeString = "x".repeat(20_000);
    let nested: Record<string, unknown> = { value: largeString };
    for (let i = 0; i < 11; i++) {
      nested = { level: nested };
    }
    const scrubbed = scrubIngestEventFields(
      { properties: nested },
      { TELEMETRY_INGEST_PII_SCRUB: "false" }
    );
    expect(scrubbed.properties).toBeTruthy();
    const extractValue = (obj: unknown, depth: number): string | null => {
      if (depth === 0 && obj && typeof obj === "object" && "value" in obj) {
        return obj.value as string;
      }
      if (obj && typeof obj === "object" && "level" in obj) {
        return extractValue(obj.level, depth - 1);
      }
      return null;
    };
    const value = extractValue(scrubbed.properties, 11);
    expect(value).toBeTruthy();
    expect(Buffer.byteLength(value!, "utf8")).toBeLessThanOrEqual(16 * 1024);
  });
});

describe("scrubIngestSessionUserEmail", () => {
  it("is a no-op when the project flag is off", () => {
    expect(scrubIngestSessionUserEmail("a@b.co", false, {})).toBe("a@b.co");
  });

  it("stores the stable [email] placeholder when enabled (not null)", () => {
    expect(scrubIngestSessionUserEmail("a@b.co", true, {})).toBe("[email]");
    expect(scrubIngestSessionUserEmail("not-an-email", true, {})).toBe("[email]");
    expect(scrubIngestSessionUserEmail(null, true, {})).toBeNull();
    expect(scrubIngestSessionUserEmail("", true, {})).toBe("");
  });

  it("respects the global ingest kill-switch", () => {
    expect(
      scrubIngestSessionUserEmail("a@b.co", true, {
        TELEMETRY_INGEST_PII_SCRUB: "false",
      })
    ).toBe("a@b.co");
  });
});
