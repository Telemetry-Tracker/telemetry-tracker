"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { restoreCookieConsentAction, syncCookieConsentAction } from "@/app/cookie-consent/actions";
import {
  COOKIE_CONSENT_CHANGED_EVENT,
  type CookieConsentChoice,
  readStoredCookieConsentChoice,
} from "@/lib/cookie-consent";
import { syncClientCookieConsentStorage } from "@/lib/cookie-consent-client";

function notifyConsentChanged(choice: CookieConsentChoice) {
  window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_CHANGED_EVENT, { detail: choice }));
}

type CookieConsentProps = {
  serverChoice?: CookieConsentChoice | null;
};

export function CookieConsent({ serverChoice = null }: CookieConsentProps) {
  const [choice, setChoice] = useState<CookieConsentChoice | null>(serverChoice);
  const [expanded, setExpanded] = useState(serverChoice == null);
  const [ready, setReady] = useState(false);
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
    } catch {
      setExpanded(true);
    } finally {
      setReady(true);
    }
  }, [serverChoice]);

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
  if (choice === "accepted") return null;

  if (choice === "rejected" && !expanded) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="fixed inset-x-0 bottom-0 z-[60] flex justify-center px-4 pb-4 sm:pb-6"
      >
        <div className="flex w-full max-w-3xl flex-col gap-3 rounded-2xl border border-border bg-surface/90 px-4 py-3 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between sm:px-5">
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
              when you accept. Read our{" "}
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
            {choice === "rejected" ? (
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
