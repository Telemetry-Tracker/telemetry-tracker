import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearGoogleAnalyticsCookies,
  disableGoogleAnalytics,
  enableGoogleAnalytics,
  gaDisableKey,
} from "./google-analytics-consent";

const ID = "G-VL5GTNNCHH";
const w = window as unknown as Record<string, unknown> & { gtag?: (...a: unknown[]) => void };

afterEach(() => {
  delete w[gaDisableKey(ID)];
  delete w.gtag;
  document.cookie.split(";").forEach((c) => {
    const n = c.trim().split("=")[0];
    if (n) document.cookie = `${n}=; Max-Age=0; Path=/`;
  });
});

describe("google-analytics-consent", () => {
  it("deletes _ga and _ga_* cookies but keeps others", () => {
    document.cookie = "_ga=GA1.1.1; Path=/";
    document.cookie = "_ga_VL5GTNNCHH=GS1; Path=/";
    document.cookie = "tt-cookie-consent=accepted; Path=/";
    document.cookie = "_gallery=keep; Path=/";
    clearGoogleAnalyticsCookies();
    expect(document.cookie).not.toMatch(/(^|; )_ga=/);
    expect(document.cookie).not.toMatch(/_ga_VL5GTNNCHH=/);
    expect(document.cookie).toMatch(/tt-cookie-consent=accepted/);
    expect(document.cookie).toMatch(/_gallery=keep/);
  });

  it("withdrawal sets ga-disable, denies analytics_storage and clears cookies", () => {
    const gtag = vi.fn();
    w.gtag = gtag;
    document.cookie = "_ga=GA1.1.1; Path=/";
    disableGoogleAnalytics(ID);
    expect(w[`ga-disable-${ID}`]).toBe(true);
    expect(gtag).toHaveBeenCalledWith("consent", "update", { analytics_storage: "denied" });
    expect(document.cookie).not.toMatch(/(^|; )_ga=/);
  });

  it("re-accept after withdrawal re-enables and grants storage; plain accept sends no consent update", () => {
    const gtag = vi.fn();
    w.gtag = gtag;
    enableGoogleAnalytics(ID);
    expect(w[gaDisableKey(ID)]).toBe(false);
    expect(gtag).not.toHaveBeenCalled();
    disableGoogleAnalytics(ID);
    enableGoogleAnalytics(ID);
    expect(w[gaDisableKey(ID)]).toBe(false);
    expect(gtag).toHaveBeenLastCalledWith("consent", "update", { analytics_storage: "granted" });
  });
});

describe("disableGoogleAnalytics clears QA markers", () => {
  it("removes the tt-qa sessionStorage flag so later pages are no longer tagged internal", async () => {
    const { isQaVisit } = await import("@/lib/qa-visit");
    sessionStorage.setItem("tt-qa", "1");
    expect(isQaVisit()).toBe(true);
    disableGoogleAnalytics("G-TEST");
    expect(sessionStorage.getItem("tt-qa")).toBeNull();
    expect(isQaVisit()).toBe(false);
  });
});
