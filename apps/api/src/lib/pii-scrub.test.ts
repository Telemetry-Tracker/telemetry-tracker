import { describe, expect, it } from "vitest";
import { scrubPiiRecord, scrubPiiText, scrubPiiValue } from "./pii-scrub.js";

describe("scrubPiiText", () => {
  it("redacts email addresses", () => {
    expect(scrubPiiText("Failed for user@example.com")).toBe("Failed for [email]");
  });

  it("redacts JWT-like tokens", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature";
    expect(scrubPiiText(`Token ${jwt}`)).toBe("Token [token]");
  });

  it("redacts bearer tokens with a stable placeholder", () => {
    expect(scrubPiiText("Authorization Bearer abc.def-ghi_123")).toContain(
      "[bearer-token]"
    );
  });

  it("redacts API key patterns", () => {
    expect(scrubPiiText("key tt_live_abcd0123efgh4567_secretpart")).toContain(
      "[api-key]"
    );
  });

  it("redacts sensitive query parameters in URLs", () => {
    expect(scrubPiiText("https://api.example.com/auth?token=abc123")).toBe(
      "https://api.example.com/auth"
    );
  });

  it("redacts standalone sensitive assignments", () => {
    expect(scrubPiiText("Failed with token=abc123")).toBe(
      "Failed with token=[redacted]"
    );
  });

  it("redacts cookie and authorization headers", () => {
    expect(scrubPiiText("cookie: session=abc123")).toBe("cookie: [cookie]");
    expect(scrubPiiText("authorization: Bearer secret")).toBe(
      "authorization: [bearer-token]"
    );
  });

  it("strips non-sensitive URL query strings", () => {
    expect(scrubPiiText("GET https://api.example.com/orders?id=123")).toBe(
      "GET https://api.example.com/orders"
    );
  });

  it("redacts UUIDs only in sensitive identifier contexts", () => {
    const id = "a0000000-0000-4000-8000-000000000001";
    const first = scrubPiiText(`user_id=${id} and user_id=${id}`);
    expect(first).toContain("[id:1]");
    expect(first.match(/\[id:1\]/g)?.length).toBe(2);
  });

  it("preserves standalone technical UUIDs such as trace IDs", () => {
    const traceId = "b0000000-0000-4000-8000-000000000002";
    expect(scrubPiiText(`trace ${traceId}`)).toContain(traceId);
  });

  it("preserves newlines in stack traces", () => {
    const stack = "Error: boom\n    at foo (app.js:1:1)\n    at bar (app.js:2:2)";
    expect(scrubPiiText(stack)).toContain("\n");
    expect(scrubPiiText(stack).split("\n")).toHaveLength(3);
  });

  it("does not collapse brief-style whitespace (multiple spaces / tabs)", () => {
    expect(scrubPiiText("Error:   boom\t\there")).toBe("Error:   boom\t\there");
  });

  it("leaves non-sensitive messages unchanged", () => {
    expect(scrubPiiText("TypeError: Cannot read property 'x' of undefined")).toBe(
      "TypeError: Cannot read property 'x' of undefined"
    );
  });

  it("redacts Luhn-valid payment card numbers", () => {
    expect(scrubPiiText("card 4111 1111 1111 1111 charged")).toBe(
      "card [card] charged"
    );
    expect(scrubPiiText("pan=4111111111111111")).toContain("[card]");
    expect(scrubPiiText("4242 4242 4242 4242")).toBe("[card]");
    expect(scrubPiiText("4242-4242-4242-4242")).toBe("[card]");
  });

  it("does not redact digit runs that fail Luhn or look like timestamps/IDs", () => {
    expect(scrubPiiText("id 4111111111111112")).toBe("id 4111111111111112");
    expect(scrubPiiText("4242424242424241")).toBe("4242424242424241");
    expect(scrubPiiText("20260716123000")).toBe("20260716123000");
  });

  it("redacts formatted and E.164 phone numbers including separators", () => {
    expect(scrubPiiText("call +15551234567")).toBe("call [phone]");
    expect(scrubPiiText("call (555) 123-4567")).toBe("call [phone]");
    expect(scrubPiiText("+386 40 123 456")).toBe("[phone]");
    expect(scrubPiiText("+1-202-555-0183")).toBe("[phone]");
  });

  it("does not redact bare digit runs as phone numbers", () => {
    expect(scrubPiiText("order 5551234567")).toBe("order 5551234567");
    expect(scrubPiiText("2025550183")).toBe("2025550183");
    expect(scrubPiiText("1234567890")).toBe("1234567890");
    expect(scrubPiiText("ref 123.456.7890")).toBe("ref 123.456.7890");
  });

  it("keeps phone and card placeholders stable under a second pass", () => {
    expect(scrubPiiText("[phone]")).toBe("[phone]");
    expect(scrubPiiText("[card]")).toBe("[card]");
    expect(scrubPiiText(scrubPiiText("+1-202-555-0183"))).toBe("[phone]");
    expect(scrubPiiText(scrubPiiText("4242 4242 4242 4242"))).toBe("[card]");
  });

  it("redacts emails embedded in stack frames", () => {
    const stack = "Error: mail user@example.com\n    at run (entry.js:10:2)";
    expect(scrubPiiText(stack)).toBe(
      "Error: mail [email]\n    at run (entry.js:10:2)"
    );
  });

  it("leaves already-scrubbed placeholders intact when applied twice", () => {
    const once = scrubPiiText("Failed for user@example.com");
    expect(once).toBe("Failed for [email]");
    expect(scrubPiiText(once)).toBe(once);
    expect(
      scrubPiiRecord({ email: "[email]", token: "[token]", x: "[redacted]" })
    ).toEqual({ email: "[email]", token: "[token]", x: "[redacted]" });
  });

  it("still matches common email formats after regex rewrite", () => {
    expect(scrubPiiText("contact user@example.com today")).toBe(
      "contact [email] today"
    );
    expect(scrubPiiText("john.doe+tag@sub.example.co.uk")).toBe("[email]");
    expect(scrubPiiText("test_user%123@domain.org")).toBe("[email]");
    expect(scrubPiiText("a@b.co")).toBe("[email]");
    expect(scrubPiiText("user@192.168.1.1.com")).toBe("[email]");
    expect(scrubPiiText("first..last@x.com")).toBe("[email]");
  });

  it("redacts Amex and other payment card formats", () => {
    expect(scrubPiiText("Amex 3782 822463 10005")).toBe("Amex [card]");
    expect(scrubPiiText("card 4222222222222")).toBe("card [card]");
    expect(scrubPiiText("4222 2222 22222")).toBe("[card]");
    expect(scrubPiiText("Diners 3056 9309 0259 04")).toBe("Diners [card]");
    expect(scrubPiiText("30569309025904")).toBe("[card]");
    expect(scrubPiiText("4111  1111  1111  1111")).toBe("[card]");
    expect(scrubPiiText("4111 - 1111 - 1111 - 1111")).toBe("[card]");
  });

  it("preserves trailing text after phone numbers", () => {
    const result = scrubPiiText("+386 40 123 456 today");
    expect(result).toBe("[phone] today");
    const resultNewline = scrubPiiText("+386 40 123 456\nnext line");
    expect(resultNewline).toBe("[phone]\nnext line");
  });

  it("redacts long password values fully", () => {
    const longPassword = "x".repeat(300);
    const result = scrubPiiText(`password=${longPassword}`);
    expect(result).toBe("password=[redacted]");
    expect(result.includes(longPassword)).toBe(false);
  });

  it("scrubs large message within time bound (shape 1-)", () => {
    const largeInput = "1-".repeat(100_000);
    const start = performance.now();
    const result = scrubPiiText(largeInput);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
    expect(result).toBe(largeInput);
  });

  it("scrubs large message within time bound (shape a. + @)", () => {
    const largeInput = "a.".repeat(100_000) + "@test";
    const start = performance.now();
    scrubPiiText(largeInput);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
  });

  it("scrubs large message within time bound (shape 1.)", () => {
    const largeInput = "1.".repeat(100_000);
    const start = performance.now();
    scrubPiiText(largeInput);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
  });

  it("scrubs large message within time bound (shape a@ + b.)", () => {
    const largeInput = "a@" + "b.".repeat(100_000);
    const start = performance.now();
    scrubPiiText(largeInput);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
  });
});

describe("scrubPiiValue / scrubPiiRecord", () => {
  it("replaces sensitive keys case-insensitively with stable placeholders", () => {
    expect(
      scrubPiiRecord({
        Email: "user@example.com",
        API_KEY: "sk-abcdefghijklmnopqrstuvwxyz",
        authorization: "Bearer abc",
        cookie: "sid=1",
        nested: { phone: "+15551212", safe: "ok" },
      })
    ).toEqual({
      Email: "[email]",
      API_KEY: "[api-key]",
      authorization: "[bearer-token]",
      cookie: "[cookie]",
      nested: { phone: "[phone]", safe: "ok" },
    });
  });

  it("leaves non-sensitive property payloads unchanged", () => {
    const props = {
      path: "/checkout",
      status: 500,
      flags: ["beta", "retry"],
      meta: { attempt: 2, region: "eu" },
    };
    expect(scrubPiiRecord(props)).toEqual(props);
  });

  it("scrubs string values under non-sensitive keys", () => {
    expect(
      scrubPiiRecord({
        note: "contact user@example.com with Bearer abc.def",
        count: 3,
      })
    ).toEqual({
      note: "contact [email] with [bearer-token]",
      count: 3,
    });
  });

  it("walks nested arrays", () => {
    expect(
      scrubPiiValue({
        items: [{ email: "a@b.com" }, { msg: "hi user@x.io" }],
      })
    ).toEqual({
      items: [{ email: "[email]" }, { msg: "hi [email]" }],
    });
  });

  it("stops walking past maxDepth without throwing and still scrubbing shallow leaves", () => {
    const deep = { a: { b: { c: { d: "user@example.com" } } } };
    expect(() => scrubPiiValue(deep, { maxDepth: 2 })).not.toThrow();
    const scrubbed = scrubPiiValue(deep, { maxDepth: 2 }) as {
      a: { b: { c: { d: string } } };
    };
    expect(scrubbed.a.b.c.d).toBe("[email]");
  });

  it("stops walking past maxNodes without throwing and still scrubs nested PII", () => {
    const payload = {
      items: Array.from({ length: 20 }, (_, i) => ({
        id: i,
        payload: { email: `user${i}@example.com` },
      })),
    };
    expect(() => scrubPiiValue(payload, { maxNodes: 3 })).not.toThrow();
    const scrubbed = scrubPiiValue(payload, { maxNodes: 3 }) as {
      items: Array<{ payload: { email: string } }>;
    };
    expect(scrubbed.items[0]?.payload.email).toBe("[email]");
    expect(scrubbed.items[19]?.payload.email).toBe("[email]");
  });

  it("applies denyKeys as [redacted] for unknown sensitive fields", () => {
    expect(
      scrubPiiRecord(
        { customerId: "cust_123", note: "ok" },
        { denyKeys: ["customer_id"] }
      )
    ).toEqual({ customerId: "[redacted]", note: "ok" });
  });

  it("keeps built-in placeholders when denyKeys overlap", () => {
    expect(
      scrubPiiRecord({ Email: "a@b.co" }, { denyKeys: ["email"] })
    ).toEqual({ Email: "[email]" });
  });
});
