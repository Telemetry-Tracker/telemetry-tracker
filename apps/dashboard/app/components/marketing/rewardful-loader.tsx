"use client";

import { useEffect, useState } from "react";
import { preferenceCookiesAllowed } from "../../lib/cookie-consent-client";

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
 */
export function RewardfulLoader() {
  const [scriptLoaded, setScriptLoaded] = useState(false);

  useEffect(() => {
    // Feature flag check (client-side)
    const enabled = process.env.NEXT_PUBLIC_AFFILIATES_ENABLED === "true";
    if (!enabled) {
      return;
    }

    // Check cookie consent
    if (!preferenceCookiesAllowed()) {
      // Not consented yet; listen for consent event
      const handleConsentChange = () => {
        if (preferenceCookiesAllowed()) {
          loadRewardfulScript();
        }
      };
      
      // Listen for storage events (consent changes in other tabs)
      window.addEventListener("storage", handleConsentChange);
      
      // Also check periodically in case consent is granted in the same tab
      const interval = setInterval(() => {
        if (preferenceCookiesAllowed()) {
          loadRewardfulScript();
          clearInterval(interval);
        }
      }, 1000);

      return () => {
        window.removeEventListener("storage", handleConsentChange);
        clearInterval(interval);
      };
    }

    // Consent already granted; load immediately
    loadRewardfulScript();
  }, []);

  function loadRewardfulScript() {
    if (scriptLoaded) {
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
        (window.rewardful as any).q = (window.rewardful as any).q || [];
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
    };

    document.head.appendChild(script);
  }

  return null; // No visual UI
}
