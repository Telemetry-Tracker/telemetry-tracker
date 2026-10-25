/**
 * Plan entitlements (provisional — replace with measured limits after real usage).
 * Tier names, caps, and dimensions may change; see docs/ENTITLEMENTS.md.
 */
export type PlanLimits = {
  /** Max ingest units per calendar month (event POST = 1, batch item = 1, error = 1, session = 1). */
  monthlyIngestUnits: number;
  maxCheckInMonitorsPerProject: number;
  /** Sustained requests/sec per project (burst can be higher with token bucket). */
  maxIngestRps: number;
  /** Distinct `app` strings allowed per project (SDK `app` field). */
  maxAppsPerProject: number;
  /** Projects per organization. */
  maxProjectsPerOrg: number;
  /** Active API keys per project. */
  maxApiKeysPerProject: number;
  /** Stored source map artifacts per project (replace uploads do not consume extra slots). */
  maxSourceMapArtifactsPerProject: number;
  /** Telemetry rows older than this (days) may be deleted by the retention job. */
  retentionDays: number;
};

export const PLAN_LIMITS: Record<"FREE" | "PRO" | "BUSINESS", PlanLimits> = {
  FREE: {
    maxCheckInMonitorsPerProject: 5,
    monthlyIngestUnits: 250_000,
    maxIngestRps: 20,
    maxAppsPerProject: 5,
    maxProjectsPerOrg: 1,
    maxApiKeysPerProject: 2,
    maxSourceMapArtifactsPerProject: 25,
    retentionDays: 14,
  },
  PRO: {
    maxCheckInMonitorsPerProject: 50,
    monthlyIngestUnits: 5_000_000,
    maxIngestRps: 100,
    maxAppsPerProject: 50,
    maxProjectsPerOrg: 10,
    maxApiKeysPerProject: 10,
    maxSourceMapArtifactsPerProject: 250,
    retentionDays: 90,
  },
  BUSINESS: {
    maxCheckInMonitorsPerProject: 500,
    monthlyIngestUnits: 50_000_000,
    maxIngestRps: 500,
    maxAppsPerProject: 500,
    maxProjectsPerOrg: 50,
    maxApiKeysPerProject: 50,
    maxSourceMapArtifactsPerProject: 2_500,
    retentionDays: 365,
  },
} as const;

export function limitsForPlan(tier: keyof typeof PLAN_LIMITS): PlanLimits {
  return PLAN_LIMITS[tier] ?? PLAN_LIMITS.FREE;
}
