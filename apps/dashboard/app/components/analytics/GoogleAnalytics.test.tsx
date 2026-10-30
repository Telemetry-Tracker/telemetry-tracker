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
});
