export const ATTRIBUTION_FIELDS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
export type SignupAttribution = Record<typeof ATTRIBUTION_FIELDS[number] | "referrer_host" | "signup_channel" | "first_landing_path", string | null>;

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
  result.first_landing_path = sanitizeLandingPath(input.first_landing_path);
  result.signup_channel = classifySignupChannel(result);
  return result;
}

/** Only same-site paths and three sanitized campaign tags are retained. */
export function sanitizeLandingPath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
  try {
    const url = new URL(raw, "https://telemetry-tracker.com");
    if (url.origin !== "https://telemetry-tracker.com") return null;
    const query = new URLSearchParams();
    for (const key of ["utm_source", "utm_medium", "utm_campaign"]) {
      const value = url.searchParams.get(key)?.trim().replace(/[^a-zA-Z0-9 _.-]/g, "").slice(0, 100);
      if (value) query.set(key, value);
    }
    const path = url.pathname.slice(0, 1024);
    return path + (query.size ? `?${query}` : "");
  } catch { return null; }
}

export function classifySignupChannel(value: Pick<SignupAttribution, "utm_source" | "utm_medium" | "referrer_host">): string {
  const source = value.utm_source?.toLowerCase() ?? "";
  const medium = value.utm_medium?.toLowerCase() ?? "";
  const host = value.referrer_host ?? "";
  const matches = (domains: string[]) => domains.some(domain => host === domain || host.endsWith(`.${domain}`));
  if (["chatgpt", "perplexity", "claude", "copilot", "gemini"].includes(source) ||
      matches(["chatgpt.com", "chat.openai.com", "perplexity.ai", "claude.ai", "copilot.microsoft.com", "gemini.google.com"])) return "ai_assistant";
  if (medium === "organic" || matches(["google.com", "google.co.uk", "google.de", "google.si", "bing.com", "duckduckgo.com", "search.yahoo.com", "search.brave.com", "ecosia.org"])) return "organic_search";
  if (["social", "social-media", "social_media"].includes(medium) ||
      ["facebook", "instagram", "linkedin", "twitter", "x", "reddit", "youtube", "tiktok"].includes(source) ||
      matches(["facebook.com", "instagram.com", "linkedin.com", "twitter.com", "x.com", "t.co", "reddit.com", "youtube.com", "tiktok.com"])) return "social";
  if (host || medium === "referral") return "referral";
  return "unknown";
}
