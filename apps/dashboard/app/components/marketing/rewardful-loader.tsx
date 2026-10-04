"use client";

import { useEffect, useState } from "react";
import { 
  preferenceCookiesAllowed, 
  readStoredCookieConsentChoice,
  COOKIE_CONSENT_CHANGED_EVENT,
  type CookieConsentChoice
} from "@/lib/cookie-consent";

declare global {
  interface Window {
    Rewardful?: {
      referral?: string;
    };
    rewardful?: (command: string, arg?: unknown) => void;
  }
}

/**
 * Load Rewardful affiliate tracking script after user consents to marketing/preference cookies.
 * Script is loaded from https://r.wdfl.co/rw.js (Rewardful CDN).
 * Never loads before consent; never sets cookies before consent.
 * On consent revoke, unload is handled by not loading on next page load.
 */
export function RewardfulLoader() {
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    // Feature flag check (client-side)
    const enabled = process.env.NEXT_PUBLIC_AFFILIATES_ENABLED === "true";
    if (!enabled) {
      return;
    }

    // Check initial consent state
    const currentChoice = readStoredCookieConsentChoice();
    if (preferenceCookiesAllowed(currentChoice)) {
      setShouldLoad(true);
    }

    // Listen for consent changes via custom event
    const handleConsentChange = (event: Event) => {
      const customEvent = event as CustomEvent<CookieConsentChoice>;
      const newChoice = customEvent.detail;
      
      if (preferenceCookiesAllowed(newChoice)) {
        setShouldLoad(true);
      } else {
        // Consent revoked - don't load script on this page
        // Next page load will not load it either
        setShouldLoad(false);
      }
    };

    window.addEventListener(COOKIE_CONSENT_CHANGED_EVENT, handleConsentChange);

    return () => {
      window.removeEventListener(COOKIE_CONSENT_CHANGED_EVENT, handleConsentChange);
    };
  }, []);

  useEffect(() => {
    if (!shouldLoad || scriptLoaded) {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }

    // Check if script is already loaded
    const existingScript = document.querySelector('script[src*="r.wdfl.co"]');
    if (existingScript) {
      setScriptLoaded(true);
      return;
    }

    // Initialize Rewardful queue
    window.rewardful =
      window.rewardful ||
      function rewardfulQueue(command: string, arg?: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window.rewardful as any).q = (window.rewardful as any).q || [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window.rewardful as any).q.push([command, arg]);
      };

    // Load Rewardful script
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://r.wdfl.co/rw.js";
    script.setAttribute("data-rewardful", process.env.NEXT_PUBLIC_REWARDFUL_API_KEY || "");
    
    script.onload = () => {
      setScriptLoaded(true);
      console.debug("[Rewardful] Script loaded");
    };
    
    script.onerror = () => {
      console.error("[Rewardful] Failed to load script");
      setScriptLoaded(true); // Mark as attempted to avoid retries
    };

    document.head.appendChild(script);
  }, [shouldLoad, scriptLoaded]);

  return null; // No visual UI
}
