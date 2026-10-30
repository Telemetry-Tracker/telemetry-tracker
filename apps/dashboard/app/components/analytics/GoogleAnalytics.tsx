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
import { disableGoogleAnalytics, enableGoogleAnalytics } from "@/lib/google-analytics-consent";

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
    // Defer one task so the new route's URL and <title> are committed before we read them.
    const timer = window.setTimeout(() => {
      if (lastTrackedPath.current === pathname) return;
      lastTrackedPath.current = pathname;
      gtag("event", "page_view", buildGaPageViewParams(window.location, document.title, pathname));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [gtagReady, shouldTrack, measurementId, pathname]);

  useEffect(() => {
    if (!consentAccepted) {
      // Reject / withdrawal: stop the already-loaded tag right away and drop its cookies (no reload).
      // Skip the first render before the stored choice is read, so accepted visitors keep their GA cookies.
      if (readStoredCookieConsentChoice() !== "accepted") disableGoogleAnalytics(measurementId);
      setGtagReady(false);
      return;
    }
    enableGoogleAnalytics(measurementId);
    if (shouldTrack && typeof window.gtag === "function") {
      setGtagReady(true);
    }
  }, [consentAccepted, shouldTrack, measurementId]);

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
