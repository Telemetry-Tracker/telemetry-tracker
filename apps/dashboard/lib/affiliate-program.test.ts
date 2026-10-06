import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AFFILIATE_COMMISSION_HOLD_DAYS,
  AFFILIATE_COMMISSION_PERCENT,
  AFFILIATE_COMMISSION_RATE_BPS,
  AFFILIATE_DEEP_LINK_DESTINATIONS,
  AFFILIATE_EARNING_EXAMPLES,
  AFFILIATE_ELIGIBLE_PLAN_TIERS,
  AFFILIATE_PAYOUT_MINIMUM_CENTS,
  AFFILIATE_PAYOUT_MINIMUM_LABEL,
  AFFILIATE_REFERRAL_WINDOW_DAYS,
  affiliateReferralUrl,
  commissionPerInvoiceCents,
  formatEurCents,
  isAffiliateProgramEnabled,
  isValidAffiliateCodeFormat,
  planMonthlyPriceCents,
  suggestAffiliateCodeFromName,
} from "./affiliate-program";
import { AFFILIATE_REFERRAL_COOKIE_MAX_AGE_SECONDS } from "./affiliate-referral";
import { PLAN_LIST_PRICES_EUR } from "./plan-pricing";

const apiLib = join(import.meta.dirname, "..", "..", "api", "src", "lib");

function apiConst(file: string, name: string): string {
  const src = readFileSync(join(apiLib, file), "utf8");
  const match = src.match(new RegExp(`export const ${name}\\s*=\\s*([^;]+);`));
  if (!match) throw new Error(`${name} not found in ${file}`);
  return match[1]!.trim();
}

describe("affiliate program constants match the API commission engine", () => {
  it("commission rate", () => {
    expect(Number(apiConst("affiliate-commission.ts", "DEFAULT_COMMISSION_RATE_BPS"))).toBe(
      AFFILIATE_COMMISSION_RATE_BPS
    );
    expect(AFFILIATE_COMMISSION_PERCENT).toBe(30);
  });

  it("hold days", () => {
    expect(Number(apiConst("affiliate-commission.ts", "COMMISSION_HOLD_DAYS"))).toBe(
      AFFILIATE_COMMISSION_HOLD_DAYS
    );
  });

  it("eligible hosted plans", () => {
    const raw = apiConst("affiliate-commission.ts", "HOSTED_PAID_PLAN_TIERS");
    expect(raw.replace(/\s+as const$/, "")).toBe(JSON.stringify(AFFILIATE_ELIGIBLE_PLAN_TIERS).replace(/,/g, ", "));
  });

  it("payout minimum", () => {
    expect(Number(apiConst("affiliate-payout.ts", "PAYOUT_MINIMUM_CENTS"))).toBe(
      AFFILIATE_PAYOUT_MINIMUM_CENTS
    );
    expect(AFFILIATE_PAYOUT_MINIMUM_LABEL).toBe(formatEurCents(5000));
  });

  it("referral window (API attribution + dashboard cookie)", () => {
    expect(Number(apiConst("organization-attribution.ts", "REFERRAL_ATTRIBUTION_WINDOW_DAYS"))).toBe(
      AFFILIATE_REFERRAL_WINDOW_DAYS
    );
    expect(AFFILIATE_REFERRAL_COOKIE_MAX_AGE_SECONDS).toBe(AFFILIATE_REFERRAL_WINDOW_DAYS * 86_400);
  });
});

describe("earning examples derive from the pricing page source", () => {
  it("uses PLAN_LIST_PRICES_EUR and floors per invoice like the API", () => {
    expect(planMonthlyPriceCents("PRO")).toBe(PLAN_LIST_PRICES_EUR.PRO * 100);
    expect(commissionPerInvoiceCents("PRO")).toBe(
      Math.floor((PLAN_LIST_PRICES_EUR.PRO * 100 * 3000) / 10_000)
    );
    expect(commissionPerInvoiceCents("BUSINESS")).toBe(
      Math.floor((PLAN_LIST_PRICES_EUR.BUSINESS * 100 * 3000) / 10_000)
    );
  });

  it("computes monthly and yearly totals", () => {
    for (const ex of AFFILIATE_EARNING_EXAMPLES) {
      const expected =
        (ex.customers.PRO ?? 0) * commissionPerInvoiceCents("PRO") +
        (ex.customers.BUSINESS ?? 0) * commissionPerInvoiceCents("BUSINESS");
      expect(ex.monthlyCents).toBe(expected);
      expect(ex.yearlyCents).toBe(expected * 12);
    }
    expect(AFFILIATE_EARNING_EXAMPLES[0]?.label).toBe("10 Pro customers");
  });

  it("formats cents in the pricing page style", () => {
    expect(formatEurCents(4500)).toBe(new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(45));
    expect(formatEurCents(450)).toMatch(/4,50/);
  });
});

describe("referral links and codes", () => {
  it("builds hosted referral URLs for every destination", () => {
    expect(affiliateReferralUrl("Alice")).toBe("https://telemetry-tracker.com/?ref=alice");
    expect(affiliateReferralUrl("alice", "/pricing")).toBe("https://telemetry-tracker.com/pricing?ref=alice");
    for (const d of AFFILIATE_DEEP_LINK_DESTINATIONS) {
      expect(affiliateReferralUrl("x1", d.path)).toBe(`https://telemetry-tracker.com${d.path}?ref=x1`);
    }
  });

  it("validates code format and suggests from names", () => {
    expect(isValidAffiliateCodeFormat("ab")).toBe(true);
    expect(isValidAffiliateCodeFormat("a")).toBe(false);
    expect(isValidAffiliateCodeFormat("has space")).toBe(false);
    expect(isValidAffiliateCodeFormat("123e4567-e89b-12d3-a456-426614174000")).toBe(false);
    expect(suggestAffiliateCodeFromName("  Željko Ćosić ")).toBe("zeljko-cosic");
    expect(suggestAffiliateCodeFromName("!!")).toBe("");
  });
});

describe("feature flag", () => {
  const original = process.env.NEXT_PUBLIC_AFFILIATES_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_AFFILIATES_ENABLED;
    else process.env.NEXT_PUBLIC_AFFILIATES_ENABLED = original;
  });
  it("is on only for the literal 'true'", () => {
    process.env.NEXT_PUBLIC_AFFILIATES_ENABLED = "true";
    expect(isAffiliateProgramEnabled()).toBe(true);
    process.env.NEXT_PUBLIC_AFFILIATES_ENABLED = "1";
    expect(isAffiliateProgramEnabled()).toBe(false);
  });
});
