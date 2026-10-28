import { describe, expect, it } from "vitest";
import { AFFILIATE_FOOTER_LINK, footerColumns } from "./footer";

describe("marketing footer affiliate link", () => {
  it("adds 'Affiliate Program — Earn 30%' to Company when the program is on", () => {
    const company = footerColumns(true).find((c) => c.heading === "Company");
    expect(company?.links).toContainEqual(AFFILIATE_FOOTER_LINK);
    expect(AFFILIATE_FOOTER_LINK).toEqual({ label: "Affiliate Program — Earn 30%", href: "/affiliates" });
  });

  it("omits it when the program is off (self-hosted builds)", () => {
    const all = footerColumns(false).flatMap((c) => c.links);
    expect(all.some((l) => l.href === "/affiliates")).toBe(false);
  });
});
