import { API_BASE_URL } from "@/lib/api-url";

/** Platform semver from public API `/health` (TELEMETRY_API_VERSION or build-time tag). */
export async function fetchPlatformVersion(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/health`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: unknown };
    return typeof data.version === "string" && data.version.trim() !== ""
      ? data.version.trim()
      : null;
  } catch {
    return null;
  }
}
