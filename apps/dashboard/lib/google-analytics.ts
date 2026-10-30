import { resolveMetadataBase } from "@/lib/site-url";

/** Official hosted-cloud measurement id when env is unset. Self-hosted deployments omit GA unless configured. */
export const HOSTED_CLOUD_GA_ID = "G-VL5GTNNCHH";

const HOSTED_CLOUD_HOST = "telemetry-tracker.com";

/**
 * Resolve GA4 measurement id on the server (root layout). Uses runtime env such as
 * `RAILWAY_PUBLIC_DOMAIN` via `resolveMetadataBase()` — do not call from client components.
 */
export function getGoogleAnalyticsMeasurementId(): string | null {
  const fromEnv = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim();
  if (fromEnv) return fromEnv;

  if (process.env.NODE_ENV !== "production") return null;

  const hostname = resolveMetadataBase()?.hostname;
  if (hostname === HOSTED_CLOUD_HOST) return HOSTED_CLOUD_GA_ID;
  return null;
}

/** Marketing and public docs routes only — not authenticated dashboard product pages. */
export function isMarketingAnalyticsPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return !pathname.startsWith("/dashboard");
}

export type GaPageViewParams = {
  page_location: string;
  page_path: string;
  page_title: string;
};

/**
 * Query keys that must never reach GA (credentials, one-time codes, invites, password resets, PII).
 * Matched case-insensitively against the whole key or as a `_`/`-` separated part (e.g. `invite_token`).
 */
const SENSITIVE_QUERY_KEYS = [
  "token",
  "access_token",
  "id_token",
  "refresh_token",
  "code",
  "state",
  "invite",
  "reset",
  "email",
  "password",
  "pass",
  "secret",
  "key",
  "apikey",
  "api_key",
  "otp",
  "signature",
  "sig",
  "session",
  "auth",
  "jwt",
  "magic",
  "verify",
  "verification",
];

export function isSensitiveQueryKey(key: string): boolean {
  const k = key.toLowerCase();
  if (SENSITIVE_QUERY_KEYS.includes(k)) return true;
  return k.split(/[_-]/).some((part) => SENSITIVE_QUERY_KEYS.includes(part));
}

/** `href` without sensitive query params; a fragment carrying `key=value` pairs (OAuth implicit flow) is dropped. */
export function sanitizeGaPageLocation(href: string): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href.split(/[?#]/)[0] ?? href;
  }
  for (const key of [...url.searchParams.keys()]) {
    if (isSensitiveQueryKey(key)) url.searchParams.delete(key);
  }
  if (url.hash.includes("=")) url.hash = "";
  return url.toString();
}

/** Params for an explicit GA4 `page_view` built from the current (already committed) location. */
export function buildGaPageViewParams(
  location: Pick<Location, "href" | "pathname">,
  title: string,
  pathname?: string | null
): GaPageViewParams {
  return {
    page_location: sanitizeGaPageLocation(location.href),
    page_path: pathname || location.pathname,
    page_title: title,
  };
}
