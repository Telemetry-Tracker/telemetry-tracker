"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { restoreCookieConsentAction, syncCookieConsentAction } from "@/app/cookie-consent/actions";
import {
  COOKIE_CONSENT_CHANGED_EVENT,
  COOKIE_SETTINGS_OPEN_EVENT,
  type CookieConsentChoice,
  readStoredCookieConsentChoice,
} from "@/lib/cookie-consent";
import { syncClientCookieConsentStorage } from "@/lib/cookie-consent-client";

function notifyConsentChanged(choice: CookieConsentChoice) {
  window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_CHANGED_EVENT, { detail: choice }));
}

const REJECTED_NOTICE_DISMISSED_KEY = "tt_cookie_rejected_notice_dismissed";

type CookieConsentProps = {
  serverChoice?: CookieConsentChoice | null;
};

export function CookieConsent({ serverChoice = null }: CookieConsentProps) {
  const [choice, setChoice] = useState<CookieConsentChoice | null>(serverChoice);
  const [expanded, setExpanded] = useState(serverChoice == null);
  const [ready, setReady] = useState(false);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    try {
      const stored = serverChoice ?? readStoredCookieConsentChoice();
      if (stored) {
        syncClientCookieConsentStorage(stored);
        if (!serverChoice) {
          void restoreCookieConsentAction(stored);
        }
        setChoice(stored);
        setExpanded(false);
        notifyConsentChanged(stored);
      } else {
        setExpanded(true);
      }
      try {
        setNoticeDismissed(window.localStorage.getItem(REJECTED_NOTICE_DISMISSED_KEY) === "1");
      } catch {
        /* ignore */
      }
    } catch {
      setExpanded(true);
    } finally {
      setReady(true);
    }
  }, [serverChoice]);

  useEffect(() => {
    const open = () => setExpanded(true);
    window.addEventListener(COOKIE_SETTINGS_OPEN_EVENT, open);
    return () => window.removeEventListener(COOKIE_SETTINGS_OPEN_EVENT, open);
  }, []);

  function decide(next: CookieConsentChoice) {
    try {
      syncClientCookieConsentStorage(next);
    } catch {
      /* ignore */
    }
    setChoice(next);
    setExpanded(false);
    notifyConsentChanged(next);
    startTransition(() => {
      void syncCookieConsentAction(next);
    });
  }

  if (!ready) return null;
  if (choice === "accepted" && !expanded) return null;

  if (choice === "rejected" && !expanded && noticeDismissed) return null;

  if (choice === "rejected" && !expanded) {
    // TT-016 (#715): the full-width wrapper must not intercept clicks (sidebar user menu / Log out),
    // and the notice can be dismissed.
    return (
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-center px-4 pb-4 sm:pb-6"
      >
        <div className="pointer-events-auto flex w-full max-w-3xl flex-col gap-3 rounded-2xl border border-border bg-surface/90 px-4 py-3 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p className="text-sm text-muted-foreground">
            Optional analytics cookies are off. Sign-in and your selected project stay saved.
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/cookies"
              className="rounded-full border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-surface-elevated"
            >
              Cookie policy
            </Link>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.02]"
            >
              Change preferences
            </button>
            <button
              type="button"
              aria-label="Dismiss cookie notice"
              onClick={() => {
                try {
                  window.localStorage.setItem(REJECTED_NOTICE_DISMISSED_KEY, "1");
                } catch {
                  /* ignore */
                }
                setNoticeDismissed(true);
              }}
              className="rounded-full border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-surface-elevated"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Cookie preferences"
      className="fixed inset-x-0 bottom-0 z-[60] flex justify-center px-4 pb-4 sm:pb-6"
    >
      <div className="w-full max-w-3xl rounded-2xl border border-border bg-surface/90 p-4 backdrop-blur-xl sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div
              aria-hidden
              className="mt-0.5 h-2 w-2 shrink-0 animate-pulse-dot rounded-full bg-brand"
            />
            <p className="text-sm leading-relaxed text-muted-foreground">
              We use a minimal set of cookies to keep the product running. Optional analytics load
              when you accept. A first-party referral cookie is stored only if you accept; same-session
              referral links still work if you decline. Read our{" "}
              <Link
                href="/cookies"
                className="text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
              >
                cookie policy
              </Link>
              .
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:justify-end">
            {choice !== null ? (
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="rounded-full border border-border px-4 py-1.5 text-sm text-foreground transition-colors hover:bg-surface-elevated"
              >
                Cancel
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => decide("rejected")}
              className="rounded-full border border-border px-4 py-1.5 text-sm text-foreground transition-colors hover:bg-surface-elevated"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={() => decide("accepted")}
              className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.02]"
            >
              Accept
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
