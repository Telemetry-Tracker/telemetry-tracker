"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  COOKIE_CONSENT_CHANGED_EVENT,
  type CookieConsentChoice,
  readStoredCookieConsentChoice,
} from "@/lib/cookie-consent";
import { buildGaPageViewParams, isMarketingAnalyticsPath } from "@/lib/google-analytics";

/** Upper bound for waiting on the new route's <title> before sending page_view anyway. */
const TITLE_WAIT_MS = 1000;

type GoogleAnalyticsProps = {
  measurementId: string | null;
  serverChoice?: CookieConsentChoice | null;
};

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export function GoogleAnalytics({ measurementId, serverChoice = null }: GoogleAnalyticsProps) {
  const pathname = usePathname();
  const [consentAccepted, setConsentAccepted] = useState(serverChoice === "accepted");
  const [gtagReady, setGtagReady] = useState(false);
  const shouldTrack = Boolean(
    measurementId && consentAccepted && isMarketingAnalyticsPath(pathname)
  );

  useEffect(() => {
    const initial = serverChoice ?? readStoredCookieConsentChoice();
    setConsentAccepted(initial === "accepted");

    function onConsentChanged(event: Event) {
      const detail = (event as CustomEvent<CookieConsentChoice>).detail;
      setConsentAccepted(detail === "accepted");
    }

    window.addEventListener(COOKIE_CONSENT_CHANGED_EVENT, onConsentChanged);
    return () => window.removeEventListener(COOKIE_CONSENT_CHANGED_EVENT, onConsentChanged);
  }, [serverChoice]);

  // Last path a page_view was sent for; cleared when tracking stops so a later accept / return counts again.
  const lastTrackedPath = useRef<string | null>(null);
  const configuredId = useRef<string | null>(null);
  const lastTrackedTitle = useRef<string | null>(null);

  useEffect(() => {
    if (!shouldTrack) lastTrackedPath.current = null;
  }, [shouldTrack]);

  useEffect(() => {
    if (!gtagReady || !shouldTrack || !measurementId || !pathname) return;
    const gtag = window.gtag;
    if (typeof gtag !== "function") return;
    if (configuredId.current !== measurementId) {
      // Page views are sent explicitly below (one per route), never by config.
      gtag("config", measurementId, { send_page_view: false });
      configuredId.current = measurementId;
    }
    // Wait for the new route's <title>: Next applies route metadata after the URL commits. If the title
    // still equals the one sent with the previous page_view, wait (max TITLE_WAIT_MS) for it to change.
    let sent = false;
    let observer: MutationObserver | null = null;
    let fallback: number | undefined;
    const send = () => {
      if (sent) return;
      sent = true;
      observer?.disconnect();
      window.clearTimeout(fallback);
      if (lastTrackedPath.current === pathname) return;
      lastTrackedPath.current = pathname;
      const params = buildGaPageViewParams(window.location, document.title, pathname);
      lastTrackedTitle.current = params.page_title;
      // `set` so later events on this page (scroll, clicks) also use the sanitized location.
      gtag("set", { page_location: params.page_location });
      gtag("event", "page_view", params);
    };
    const timer = window.setTimeout(() => {
      if (lastTrackedPath.current === null || document.title !== lastTrackedTitle.current) {
        send();
        return;
      }
      if (typeof MutationObserver === "function") {
        observer = new MutationObserver(() => {
          if (document.title !== lastTrackedTitle.current) send();
        });
        observer.observe(document.head, { subtree: true, childList: true, characterData: true });
      }
      fallback = window.setTimeout(send, TITLE_WAIT_MS);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(fallback);
      observer?.disconnect();
    };
  }, [gtagReady, shouldTrack, measurementId, pathname]);

  useEffect(() => {
    if (!consentAccepted) {
      setGtagReady(false);
      return;
    }
    if (shouldTrack && typeof window.gtag === "function") {
      setGtagReady(true);
    }
  }, [consentAccepted, shouldTrack]);

  if (!shouldTrack) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
        strategy="afterInteractive"
      />
      <Script
        id="google-analytics"
        strategy="afterInteractive"
        onReady={() => setGtagReady(true)}
      >
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          window.gtag = gtag;
          gtag('js', new Date());
        `}
      </Script>
    </>
  );
}
