import { describe, expect, it } from "vitest";
import {
  APPLICATION_PROMOTION_MAX,
  APPLICATION_PROMOTION_MIN,
  CLIENT_IP_FORWARD_HEADER,
  DEFAULT_APPLICATION_RATE_LIMIT_MAX,
  DEFAULT_APPLICATIONS_MAX_PER_HOUR,
  applicationRateLimitKey,
  applicationRateLimitMax,
  applicationsMaxPerHour,
  isHoneypotTripped,
  isPlausibleEmail,
  normalizeApplicantUrl,
  parseAffiliateApplicationInput,
  parseApplicationNotifyEmails,
  parseApplicationStatusFilter,
} from "./affiliate-application.js";

const valid = {
  name: "Ada Lovelace",
  email: "Ada@Example.com",
  websiteUrl: "https://ada.dev/blog",
  promotionPlan: "Weekly newsletter for 4k frontend developers plus a YouTube channel.",
  acceptTerms: true,
  termsVersion: "2026-10-06",
};

describe("parseAffiliateApplicationInput", () => {
  it("accepts a valid application and normalizes email + URL", () => {
    const result = parseAffiliateApplicationInput(valid);
    expect(result).toEqual({
      ok: true,
      value: {
        name: "Ada Lovelace",
        email: "ada@example.com",
        websiteUrl: "https://ada.dev/blog",
        promotionPlan: valid.promotionPlan,
        termsVersion: "2026-10-06",
      },
    });
  });

  it("requires every field and the terms checkbox", () => {
    const result = parseAffiliateApplicationInput({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.fields).sort()).toEqual(
      ["acceptTerms", "email", "name", "promotionPlan", "websiteUrl"].sort()
    );
  });

  it("only treats boolean true as accepting the terms", () => {
    for (const acceptTerms of ["true", "on", 1, false, undefined]) {
      const result = parseAffiliateApplicationInput({ ...valid, acceptTerms });
      expect(result.ok).toBe(false);
    }
  });

  it("enforces length limits", () => {
    const longName = parseAffiliateApplicationInput({ ...valid, name: "x".repeat(101) });
    expect(longName.ok ? null : longName.fields.name).toBe("Too long");
    const shortPlan = parseAffiliateApplicationInput({
      ...valid,
      promotionPlan: "x".repeat(APPLICATION_PROMOTION_MIN - 1),
    });
    expect(shortPlan.ok ? null : shortPlan.fields.promotionPlan).toMatch(/at least/);
    const longPlan = parseAffiliateApplicationInput({
      ...valid,
      promotionPlan: "x".repeat(APPLICATION_PROMOTION_MAX + 1),
    });
    expect(longPlan.ok ? null : longPlan.fields.promotionPlan).toMatch(/under/);
    const longEmail = parseAffiliateApplicationInput({
      ...valid,
      email: `${"a".repeat(250)}@x.io`,
    });
    expect(longEmail.ok).toBe(false);
  });

  it("strips control characters and newlines from single-line fields", () => {
    const result = parseAffiliateApplicationInput({ ...valid, name: "Ada\r\nBcc: x\u0000" });
    expect(result.ok && result.value.name).toBe("Ada Bcc: x");
  });

  it("falls back to 'unspecified' for a malformed terms version", () => {
    const result = parseAffiliateApplicationInput({ ...valid, termsVersion: "<script>" });
    expect(result.ok && result.value.termsVersion).toBe("unspecified");
  });

  it("rejects non-string field types", () => {
    const result = parseAffiliateApplicationInput({ ...valid, name: { $ne: "" }, email: ["a@b.co"] });
    expect(result.ok).toBe(false);
  });
});

describe("normalizeApplicantUrl", () => {
  it("accepts http(s) URLs and adds https:// to bare hosts", () => {
    expect(normalizeApplicantUrl("https://github.com/ada")).toBe("https://github.com/ada");
    expect(normalizeApplicantUrl("youtube.com/@ada")).toBe("https://youtube.com/@ada");
    expect(normalizeApplicantUrl("http://ada.dev")).toBe("http://ada.dev/");
  });

  it("rejects other schemes, credentials, dotless hosts, and overlong URLs", () => {
    expect(normalizeApplicantUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeApplicantUrl("ftp://ada.dev")).toBeNull();
    expect(normalizeApplicantUrl("https://user:pass@ada.dev")).toBeNull();
    expect(normalizeApplicantUrl("https://localhost")).toBeNull();
    expect(normalizeApplicantUrl(`https://ada.dev/${"a".repeat(300)}`)).toBeNull();
    expect(normalizeApplicantUrl("not a url")).toBeNull();
  });
});

describe("abuse helpers", () => {
  it("detects the honeypot", () => {
    expect(isHoneypotTripped({})).toBe(false);
    expect(isHoneypotTripped({ company_website: "" })).toBe(false);
    expect(isHoneypotTripped({ company_website: "   " })).toBe(false);
    expect(isHoneypotTripped({ company_website: "https://spam.example" })).toBe(true);
    expect(isHoneypotTripped({ company_website: true })).toBe(true);
  });

  it("keys the rate limit by the forwarded visitor IP only when it is a valid IP", () => {
    expect(
      applicationRateLimitKey({ ip: "10.0.0.1", headers: { [CLIENT_IP_FORWARD_HEADER]: "203.0.113.7" } })
    ).toBe("affiliate-application:203.0.113.7");
    expect(
      applicationRateLimitKey({ ip: "10.0.0.1", headers: { [CLIENT_IP_FORWARD_HEADER]: "2001:db8::1" } })
    ).toBe("affiliate-application:2001:db8::1");
    expect(
      applicationRateLimitKey({ ip: "10.0.0.1", headers: { [CLIENT_IP_FORWARD_HEADER]: "evil, 1.1.1.1" } })
    ).toBe("affiliate-application:10.0.0.1");
    expect(applicationRateLimitKey({ ip: "10.0.0.1", headers: {} })).toBe(
      "affiliate-application:10.0.0.1"
    );
  });

  it("reads rate-limit and hourly-cap env with safe fallbacks", () => {
    expect(applicationRateLimitMax({})).toBe(DEFAULT_APPLICATION_RATE_LIMIT_MAX);
    expect(applicationRateLimitMax({ RATE_LIMIT_AFFILIATE_APPLICATION_MAX: "12" })).toBe(12);
    expect(applicationRateLimitMax({ RATE_LIMIT_AFFILIATE_APPLICATION_MAX: "-1" })).toBe(
      DEFAULT_APPLICATION_RATE_LIMIT_MAX
    );
    expect(applicationsMaxPerHour({})).toBe(DEFAULT_APPLICATIONS_MAX_PER_HOUR);
    expect(applicationsMaxPerHour({ AFFILIATE_APPLICATIONS_MAX_PER_HOUR: "abc" })).toBe(
      DEFAULT_APPLICATIONS_MAX_PER_HOUR
    );
  });

  it("parses founder notification recipients and drops invalid entries", () => {
    expect(parseApplicationNotifyEmails({})).toEqual([]);
    expect(
      parseApplicationNotifyEmails({ AFFILIATE_APPLICATION_NOTIFY_EMAILS: " a@x.io, nope ,b@y.dev" })
    ).toEqual(["a@x.io", "b@y.dev"]);
  });

  it("checks email shape linearly", () => {
    expect(isPlausibleEmail("a@b.co")).toBe(true);
    expect(isPlausibleEmail("a@@b.co")).toBe(false);
    expect(isPlausibleEmail("a b@c.co")).toBe(false);
    expect(isPlausibleEmail("a@bco")).toBe(false);
  });
});

describe("parseApplicationStatusFilter", () => {
  it("defaults to pending and accepts known statuses + all", () => {
    expect(parseApplicationStatusFilter(undefined)).toBe("pending");
    expect(parseApplicationStatusFilter("")).toBe("pending");
    expect(parseApplicationStatusFilter("approved")).toBe("approved");
    expect(parseApplicationStatusFilter("rejected")).toBe("rejected");
    expect(parseApplicationStatusFilter("all")).toBe("all");
    expect(parseApplicationStatusFilter("deleted")).toBeNull();
  });
});
