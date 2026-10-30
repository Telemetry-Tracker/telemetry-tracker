import { afterEach, describe, expect, it } from "vitest";
import { isQaSignal, isQaVisit, qaCookieString, qaTrafficParams } from "./qa-visit";

afterEach(() => {
  document.cookie = "qa=; Max-Age=0; Path=/";
  sessionStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("qa-visit", () => {
  it("detects ?qa=1, utm_source=qa / qa_*, and the TackoQA user agent", () => {
    expect(isQaSignal("?qa=1", "Mozilla")).toBe(true);
    expect(isQaSignal("?utm_source=qa&utm_medium=audit", "Mozilla")).toBe(true);
    expect(isQaSignal("?utm_source=qa_probe", "Mozilla")).toBe(true);
    expect(isQaSignal("", "Mozilla/5.0 TackoQA-Audit")).toBe(true);
    expect(isQaSignal("?utm_source=quora", "Mozilla")).toBe(false);
    expect(isQaSignal("?qa=0", "Mozilla")).toBe(false);
  });

  it("cookie is scoped to .telemetry-tracker.com on the hosted site and Secure on https", () => {
    expect(qaCookieString("telemetry-tracker.com", "https:")).toBe(
      "qa=1; Max-Age=2592000; Path=/; SameSite=Lax; Secure; Domain=.telemetry-tracker.com"
    );
    expect(qaCookieString("localhost", "http:")).toBe("qa=1; Max-Age=2592000; Path=/; SameSite=Lax");
  });

  it("sets the qa cookie and keeps tagging later pages without the URL flag", () => {
    window.history.replaceState({}, "", "/?qa=1");
    expect(qaTrafficParams()).toEqual({ traffic_type: "internal" });
    expect(document.cookie).toMatch(/(^|; )qa=1/);
    window.history.replaceState({}, "", "/docs");
    expect(isQaVisit()).toBe(true);
  });

  it("normal visits get no traffic_type", () => {
    expect(qaTrafficParams()).toEqual({});
  });
});
