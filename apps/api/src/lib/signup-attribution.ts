export const ATTRIBUTION_FIELDS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
export type SignupAttribution = Record<typeof ATTRIBUTION_FIELDS[number] | "referrer_host", string | null>;

export function sanitizeSignupAttribution(raw: unknown): SignupAttribution {
  const input = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const result = {} as SignupAttribution;
  for (const field of ATTRIBUTION_FIELDS) {
    const value = input[field];
    result[field] = typeof value === "string"
      ? value.slice(0, 1000).trim().replace(/[^a-zA-Z0-9 _.-]/g, "").slice(0, 100) || null
      : null;
  }
  result.referrer_host = null;
  if (typeof input.referrer_host === "string") {
    try {
      const url = new URL(input.referrer_host.includes("://") ? input.referrer_host : `https://${input.referrer_host}`);
      const host = url.hostname.toLowerCase();
      if (["http:", "https:"].includes(url.protocol) && host.length <= 253 &&
          /^[a-z0-9.-]+$/.test(host) && host !== "telemetry-tracker.com" &&
          !host.endsWith(".telemetry-tracker.com")) result.referrer_host = host;
    } catch { /* malformed referrers are absent */ }
  }
  return result;
}
