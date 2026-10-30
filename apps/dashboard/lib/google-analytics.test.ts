import { describe, expect, it, afterEach } from "vitest";
import {
  gaReferrerParams,
  isSensitiveQueryKey,
  sanitizeGaPageLocation,
  getGoogleAnalyticsMeasurementId,
  HOSTED_CLOUD_GA_ID,
  isMarketingAnalyticsPath,
} from "./google-analytics";

describe("getGoogleAnalyticsMeasurementId", () => {
  const env = process.env;

  afterEach(() => {
    process.env = { ...env };
  });

  it("returns explicit env override", () => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "G-TEST123";
    expect(getGoogleAnalyticsMeasurementId()).toBe("G-TEST123");
  });

  it("returns hosted-cloud default when metadata base hostname matches", () => {
    delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
    process.env.NODE_ENV = "production";
    process.env.NEXT_PUBLIC_SITE_URL = "https://telemetry-tracker.com";
    expect(getGoogleAnalyticsMeasurementId()).toBe(HOSTED_CLOUD_GA_ID);
  });

  it("resolves hosted-cloud default from RAILWAY_PUBLIC_DOMAIN at runtime", () => {
    delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    process.env.NODE_ENV = "production";
    process.env.RAILWAY_PUBLIC_DOMAIN = "telemetry-tracker.com";
    expect(getGoogleAnalyticsMeasurementId()).toBe(HOSTED_CLOUD_GA_ID);
  });

  it("returns null for self-hosted production without env", () => {
    delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
    process.env.NODE_ENV = "production";
    process.env.NEXT_PUBLIC_SITE_URL = "https://telemetry.example.com";
    delete process.env.RAILWAY_PUBLIC_DOMAIN;
    delete process.env.VERCEL_URL;
    expect(getGoogleAnalyticsMeasurementId()).toBeNull();
  });

  it("returns null in development without env", () => {
    delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
    process.env.NODE_ENV = "development";
    expect(getGoogleAnalyticsMeasurementId()).toBeNull();
  });
});

describe("isMarketingAnalyticsPath", () => {
  it("allows marketing and docs routes", () => {
    expect(isMarketingAnalyticsPath("/")).toBe(true);
    expect(isMarketingAnalyticsPath("/docs/releases")).toBe(true);
    expect(isMarketingAnalyticsPath("/login")).toBe(true);
  });

  it("blocks dashboard product routes", () => {
    expect(isMarketingAnalyticsPath("/dashboard")).toBe(false);
    expect(isMarketingAnalyticsPath("/dashboard/overview")).toBe(false);
    expect(isMarketingAnalyticsPath("/dashboard/settings/billing")).toBe(false);
  });

  it("returns false when pathname is null or empty", () => {
    expect(isMarketingAnalyticsPath(null)).toBe(false);
    expect(isMarketingAnalyticsPath(undefined)).toBe(false);
    expect(isMarketingAnalyticsPath("")).toBe(false);
  });
});

describe("sanitizeGaPageLocation", () => {
  it("removes credential, reset, invite and email params and keeps the rest", () => {
    expect(
      sanitizeGaPageLocation(
        "https://telemetry-tracker.com/reset-password?token=t&code=c&reset=1&Email=x@y.z&invite=i&ref=hn&utm_source=x"
      )
    ).toBe("https://telemetry-tracker.com/reset-password?ref=hn&utm_source=x");
    expect(sanitizeGaPageLocation("https://telemetry-tracker.com/a?invite_token=1&reset-code=2&api_key=3&page=2")).toBe(
      "https://telemetry-tracker.com/a?page=2"
    );
  });
  it("drops key=value fragments but keeps anchors", () => {
    expect(sanitizeGaPageLocation("https://t.com/cb#access_token=x&state=y")).toBe("https://t.com/cb");
    expect(sanitizeGaPageLocation("https://t.com/docs#install")).toBe("https://t.com/docs#install");
  });
  it("does not strip harmless keys that merely contain a sensitive word", () => {
    expect(isSensitiveQueryKey("tokenizer")).toBe(false);
    expect(isSensitiveQueryKey("postcode")).toBe(false);
    expect(isSensitiveQueryKey("utm_source")).toBe(false);
    expect(isSensitiveQueryKey("magic_link")).toBe(true);
  });
});


describe("gaReferrerParams", () => {
  it("strips sensitive params from reset/invite referrers and is empty without a referrer", () => {
    expect(gaReferrerParams("https://telemetry-tracker.com/reset-password?token=t&email=a%40b.c&ref=hn")).toEqual({
      page_referrer: "https://telemetry-tracker.com/reset-password?ref=hn",
    });
    expect(gaReferrerParams("https://news.ycombinator.com/item?id=1")).toEqual({ page_referrer: "https://news.ycombinator.com/item?id=1" });
    expect(gaReferrerParams("")).toEqual({});
  });
});
