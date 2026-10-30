import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CookieConsent } from "./cookie-consent";
import { CookieSettingsButton } from "./cookie-settings-button";
import { COOKIE_CONSENT_CHANGED_EVENT, COOKIE_CONSENT_STORAGE_KEY } from "@/lib/cookie-consent";

vi.mock("@/app/cookie-consent/actions", () => ({
  restoreCookieConsentAction: vi.fn(async () => undefined),
  syncCookieConsentAction: vi.fn(async () => undefined),
}));

describe("CookieConsent withdrawal", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.cookie = `${COOKIE_CONSENT_STORAGE_KEY}=; Path=/; Max-Age=0`;
  });
  afterEach(() => cleanup());

  it("after Accept, 'Cookie settings' reopens the banner and Reject withdraws consent", async () => {
    const events: string[] = [];
    const onChange = (e: Event) => events.push((e as CustomEvent<string>).detail);
    window.addEventListener(COOKIE_CONSENT_CHANGED_EVENT, onChange);
    render(
      <>
        <CookieConsent />
        <CookieSettingsButton />
      </>
    );
    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)).toBe("accepted");

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cookie settings" })));
    expect(screen.getByRole("dialog", { name: "Cookie preferences" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)).toBe("rejected");
    expect(events).toEqual(["accepted", "rejected"]);
    window.removeEventListener(COOKIE_CONSENT_CHANGED_EVENT, onChange);
  });

  it("Cancel keeps an accepted choice", async () => {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, "accepted");
    render(
      <>
        <CookieConsent />
        <CookieSettingsButton />
      </>
    );
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Cookie settings" })));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)).toBe("accepted");
  });
});
