import { act, cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleAnalytics } from "./GoogleAnalytics";
import { COOKIE_CONSENT_CHANGED_EVENT, COOKIE_CONSENT_STORAGE_KEY } from "@/lib/cookie-consent";

const pathnameMock = vi.fn(() => "/");
vi.mock("next/navigation", () => ({ usePathname: () => pathnameMock() }));
vi.mock("next/script", () => ({
  default: function ScriptMock({ onReady }: { onReady?: () => void }) {
    useEffect(() => {
      onReady?.();
    }, [onReady]);
    return null;
  },
}));

const ID = "G-TEST123";

function go(path: string, title: string) {
  window.history.pushState({}, "", path);
  document.title = title;
  pathnameMock.mockReturnValue(path.split("?")[0]!);
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });

describe("GoogleAnalytics page views", () => {
  let gtag: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    gtag = vi.fn();
    window.gtag = gtag;
    go("/", "Home");
  });
  afterEach(() => {
    cleanup();
    delete window.gtag;
  });

  const pageViews = () => gtag.mock.calls.filter((c) => c[0] === "event" && c[1] === "page_view");

  it("configures with send_page_view:false and sends exactly one page_view per route with current values", async () => {
    const { rerender } = render(<GoogleAnalytics measurementId={ID} serverChoice="accepted" />);
    await flush();
    expect(gtag.mock.calls.filter((c) => c[0] === "config")).toEqual([["config", ID, { send_page_view: false }]]);
    expect(pageViews()).toHaveLength(1);
    expect(pageViews()[0]![2]).toEqual({ page_location: "http://localhost:3000/", page_path: "/", page_title: "Home" });

    // first in-site (client) navigation
    go("/docs?x=1", "Docs");
    rerender(<GoogleAnalytics measurementId={ID} serverChoice="accepted" />);
    await flush();
    expect(pageViews()).toHaveLength(2);
    expect(pageViews()[1]![2]).toEqual({ page_location: "http://localhost:3000/docs?x=1", page_path: "/docs", page_title: "Docs" });

    // re-render on the same path does not duplicate
    rerender(<GoogleAnalytics measurementId={ID} serverChoice="accepted" />);
    await flush();
    expect(pageViews()).toHaveLength(2);

    // back navigation sends the restored page, not the previous one
    go("/", "Home");
    rerender(<GoogleAnalytics measurementId={ID} serverChoice="accepted" />);
    await flush();
    expect(pageViews()).toHaveLength(3);
    expect(pageViews()[2]![2]).toMatchObject({ page_location: "http://localhost:3000/", page_path: "/" });
    expect(gtag.mock.calls.filter((c) => c[0] === "config")).toHaveLength(1);
  });

  it("waits for the new route's title when it is applied after the URL commits", async () => {
    const { rerender } = render(<GoogleAnalytics measurementId={ID} serverChoice="accepted" />);
    await flush();
    // URL changes first; Next applies the new <title> a moment later.
    window.history.pushState({}, "", "/pricing");
    pathnameMock.mockReturnValue("/pricing");
    rerender(<GoogleAnalytics measurementId={ID} serverChoice="accepted" />);
    await flush();
    expect(pageViews()).toHaveLength(1);
    document.title = "Pricing";
    await flush();
    expect(pageViews()).toHaveLength(2);
    expect(pageViews()[1]![2]).toMatchObject({ page_path: "/pricing", page_title: "Pricing" });
  });

  it("still sends once (after the wait) when two routes share a title", async () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<GoogleAnalytics measurementId={ID} serverChoice="accepted" />);
      await act(async () => { await vi.advanceTimersByTimeAsync(5); });
      go("/same", "Home");
      rerender(<GoogleAnalytics measurementId={ID} serverChoice="accepted" />);
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      expect(pageViews()).toHaveLength(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(pageViews()).toHaveLength(2);
      expect(pageViews()[1]![2]).toMatchObject({ page_path: "/same", page_title: "Home" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("strips sensitive query params from page_location and sets it for later events", async () => {
    go("/invite/accept?token=abc&email=a%40b.c&utm_source=x&invite_code=1#access_token=zzz", "Invite");
    render(<GoogleAnalytics measurementId={ID} serverChoice="accepted" />);
    await flush();
    const loc = "http://localhost:3000/invite/accept?utm_source=x";
    expect(pageViews()[0]![2]).toMatchObject({ page_location: loc, page_path: "/invite/accept" });
    expect(gtag).toHaveBeenCalledWith("set", { page_location: loc });
    expect(JSON.stringify(gtag.mock.calls)).not.toMatch(/abc|a%40b|zzz/);
  });

  it("sanitizes page_referrer on config, set and every page_view (full reload from a reset link, then client nav)", async () => {
    const ref = vi.spyOn(document, "referrer", "get").mockReturnValue(
      "http://localhost:3000/reset?token=RST123&email=a%40b.c&code=XYZ&utm_source=x#access_token=FRAG"
    );
    try {
      go("/login?token=T2&next=/docs", "Login");
      const { rerender } = render(<GoogleAnalytics measurementId={ID} serverChoice="accepted" />);
      await flush();
      const clean = "http://localhost:3000/reset?utm_source=x";
      expect(gtag.mock.calls.filter((c) => c[0] === "config")[0]![2]).toMatchObject({ page_referrer: clean });
      expect(pageViews()[0]![2]).toMatchObject({ page_referrer: clean, page_location: "http://localhost:3000/login?next=%2Fdocs" });
      go("/docs", "Docs");
      rerender(<GoogleAnalytics measurementId={ID} serverChoice="accepted" />);
      await flush();
      expect(pageViews()[1]![2]).toMatchObject({ page_referrer: clean });
      expect(gtag).toHaveBeenCalledWith("set", expect.objectContaining({ page_referrer: clean }));
      expect(JSON.stringify(gtag.mock.calls)).not.toMatch(/RST123|a%40b|XYZ|FRAG|T2/);
    } finally {
      ref.mockRestore();
    }
  });

  it("omits page_referrer when there is none", async () => {
    render(<GoogleAnalytics measurementId={ID} serverChoice="accepted" />);
    await flush();
    expect("page_referrer" in pageViews()[0]![2]).toBe(false);
  });

  it("sends nothing without consent", async () => {
    render(<GoogleAnalytics measurementId={ID} serverChoice="rejected" />);
    await flush();
    expect(gtag.mock.calls.filter((c) => c[0] === "config" || c[0] === "event")).toHaveLength(0);
  });

  it("does not track dashboard routes", async () => {
    go("/dashboard/issues", "Issues");
    render(<GoogleAnalytics measurementId={ID} serverChoice="accepted" />);
    await flush();
    expect(pageViews()).toHaveLength(0);
  });

  it("withdrawal without reload: ga-disable, consent denied, _ga cookies deleted, no further page_view", async () => {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, "accepted");
    document.cookie = "_ga=GA1.1.1; Path=/";
    document.cookie = "_ga_TEST123=GS1; Path=/";
    const { rerender } = render(<GoogleAnalytics measurementId={ID} />);
    await flush();
    expect(pageViews()).toHaveLength(1);
    expect(document.cookie).toMatch(/_ga=/);

    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, "rejected");
    await act(async () => {
      window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_CHANGED_EVENT, { detail: "rejected" }));
    });
    expect((window as unknown as Record<string, unknown>)[`ga-disable-${ID}`]).toBe(true);
    expect(gtag).toHaveBeenCalledWith("consent", "update", { analytics_storage: "denied" });
    expect(document.cookie).not.toMatch(/_ga/);

    go("/docs", "Docs");
    rerender(<GoogleAnalytics measurementId={ID} />);
    await flush();
    expect(pageViews()).toHaveLength(1);
    window.localStorage.clear();
    delete (window as unknown as Record<string, unknown>)[`ga-disable-${ID}`];
  });

  it("QA visits (?qa=1) tag config and every page_view with traffic_type=internal", async () => {
    go("/?qa=1", "Home");
    const { rerender } = render(<GoogleAnalytics measurementId={ID} serverChoice="accepted" />);
    await flush();
    expect(gtag.mock.calls.find((c) => c[0] === "config")).toEqual([
      "config",
      ID,
      { send_page_view: false, traffic_type: "internal" },
    ]);
    go("/docs", "Docs");
    rerender(<GoogleAnalytics measurementId={ID} serverChoice="accepted" />);
    await flush();
    expect(pageViews().map((c) => c[2].traffic_type)).toEqual(["internal", "internal"]);
    document.cookie = "qa=; Max-Age=0; Path=/";
    sessionStorage.clear();
  });
});
