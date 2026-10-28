import { describe, expect, it } from "vitest";
import { isAffiliateAdminEmail, parseAffiliateAdminEmails } from "./affiliate-admin.js";

describe("affiliate admin allowlist", () => {
  it("parses comma-separated emails and ignores blanks", () => {
    expect(
      parseAffiliateAdminEmails({
        AFFILIATE_ADMIN_EMAILS: " Founder@Example.com, admin@tt.dev, ,",
      })
    ).toEqual(["founder@example.com", "admin@tt.dev"]);
  });

  it("matches allowlisted emails case-insensitively", () => {
    const env = { AFFILIATE_ADMIN_EMAILS: "founder@example.com" };
    expect(isAffiliateAdminEmail("Founder@Example.com", env)).toBe(true);
    expect(isAffiliateAdminEmail("other@example.com", env)).toBe(false);
    expect(isAffiliateAdminEmail("founder@example.com", { AFFILIATE_ADMIN_EMAILS: "" })).toBe(
      false
    );
  });
});
