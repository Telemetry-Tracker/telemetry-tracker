import { Prisma, type PlanTier, type PrismaClient } from "@prisma/client";
import { limitsForPlan, type PlanLimits } from "../config/plans.js";
import { currentYearMonth } from "./usage-meter.js";

type PlanDbClient = PrismaClient | Prisma.TransactionClient;

export type PlanContext = {
  organizationId: string;
  planTier: PlanTier;
  limits: PlanLimits;
};

const QUOTA_EXCEEDED = "Monthly ingest quota exceeded for this project.";
const APP_LIMIT = "Distinct app label limit reached for this project (plan limit).";
const PROJECT_LIMIT = "Project limit reached for this organization (plan limit).";
const KEY_LIMIT = "API key limit reached for this project (plan limit).";

export async function loadPlanContextForProject(
  prisma: PlanDbClient,
  projectId: string
): Promise<PlanContext | null> {
  const row = await prisma.project.findFirst({
    where: { id: projectId, deleted_at: null },
    select: {
      organization_id: true,
      organization: {
        select: { plan_tier: true, deleted_at: true },
      },
    },
  });
  if (!row || row.organization.deleted_at) return null;
  const tier = row.organization.plan_tier;
  return {
    organizationId: row.organization_id,
    planTier: tier,
    limits: limitsForPlan(tier),
  };
}

export async function getMonthlyIngestUsed(
  prisma: PlanDbClient,
  projectId: string
): Promise<number> {
  const ym = currentYearMonth();
  const row = await prisma.usageMonthly.findUnique({
    where: {
      project_id_year_month: { project_id: projectId, year_month: ym },
    },
    select: { ingest_units: true },
  });
  return row?.ingest_units ?? 0;
}

function checkMonthlyIngestUnits(
  used: number,
  additional: number,
  limits: PlanLimits
): { ok: true } | { ok: false; error: string } {
  if (used + additional > limits.monthlyIngestUnits) {
    return { ok: false, error: QUOTA_EXCEEDED };
  }
  return { ok: true };
}

/**
 * Which of the given `app` labels already appear in Event / Session / ErrorGroup for this project.
 * Scoped `IN (...)` queries — avoids a full distinct scan on every ingest when labels are unchanged.
 */
async function findAppsAlreadyRegisteredInProject(
  prisma: PlanDbClient,
  projectId: string,
  appLabels: string[]
): Promise<Set<string>> {
  const unique = [...new Set(appLabels)];
  if (unique.length === 0) return new Set();
  const inList = Prisma.join(unique.map((a) => Prisma.sql`${a}`));
  const rows = await prisma.$queryRaw<{ app: string }[]>(Prisma.sql`
    SELECT DISTINCT app FROM (
      SELECT app FROM "Event" WHERE project_id = ${projectId} AND app IN (${inList})
      UNION
      SELECT app FROM "Session" WHERE project_id = ${projectId} AND app IN (${inList})
      UNION
      SELECT app FROM "ErrorGroup" WHERE project_id = ${projectId} AND app IN (${inList})
    ) AS u
  `);
  return new Set(rows.map((r) => r.app));
}

/** Full distinct app count — only call when the ingest payload may introduce new app labels. */
async function countDistinctAppsInProject(
  prisma: PlanDbClient,
  projectId: string
): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM (
      SELECT DISTINCT app FROM "Event" WHERE project_id = ${projectId}
      UNION
      SELECT DISTINCT app FROM "Session" WHERE project_id = ${projectId}
      UNION
      SELECT DISTINCT app FROM "ErrorGroup" WHERE project_id = ${projectId}
    ) AS u
  `;
  return Number(rows[0]?.n ?? 0);
}

export async function assertIngestPlanOrReply(
  prisma: PlanDbClient,
  projectId: string,
  additionalUnits: number,
  appLabels: string[]
): Promise<{ ok: true } | { ok: false; status: number; body: Record<string, unknown> }> {
  const ctx = await loadPlanContextForProject(prisma, projectId);
  if (!ctx) {
    return {
      ok: false,
      status: 403,
      body: { error: "Project not found or organization inactive." },
    };
  }
  const used = await getMonthlyIngestUsed(prisma, projectId);
  const m = checkMonthlyIngestUnits(used, additionalUnits, ctx.limits);
  if (!m.ok) {
    return {
      ok: false,
      status: 429,
      body: {
        error: m.error,
        code: "monthly_ingest_quota",
        limit: ctx.limits.monthlyIngestUnits,
        used,
      },
    };
  }
  const uniqueLabels = [...new Set(appLabels)];
  const already = await findAppsAlreadyRegisteredInProject(
    prisma,
    projectId,
    uniqueLabels
  );
  const newLabels = uniqueLabels.filter((a) => !already.has(a));
  if (newLabels.length > 0) {
    const totalDistinct = await countDistinctAppsInProject(prisma, projectId);
    if (totalDistinct + newLabels.length > ctx.limits.maxAppsPerProject) {
      return {
        ok: false,
        status: 403,
        body: {
          error: APP_LIMIT,
          code: "max_apps_per_project",
          limit: ctx.limits.maxAppsPerProject,
        },
      };
    }
  }
  return { ok: true };
}

const SERIALIZABLE_TX = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 5000,
  timeout: 15000,
} as const;

const SERIALIZABLE_RETRY_ATTEMPTS = 5;

function isPrismaTransactionConflict(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code: unknown }).code === "P2034"
  );
}

export async function runSerializableTransaction<T>(
  prisma: PrismaClient,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  for (let attempt = 0; attempt < SERIALIZABLE_RETRY_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(fn, SERIALIZABLE_TX);
    } catch (e) {
      const retry =
        isPrismaTransactionConflict(e) && attempt < SERIALIZABLE_RETRY_ATTEMPTS - 1;
      if (!retry) throw e;
    }
  }
  throw new Error("runSerializableTransaction: exhausted retries");
}

export type CreateProjectPlanResult =
  | {
      ok: true;
      project: {
        id: string;
        name: string;
        slug: string;
        organization_id: string;
      };
    }
  | { ok: false; error: string; code: "org_not_found" | "max_projects_per_org" };

/**
 * Count + insert under serializable isolation so concurrent creates cannot exceed the plan cap.
 */
export async function createProjectWithPlanLimitCheck(
  prisma: PrismaClient,
  organizationId: string,
  data: { name: string; slug: string }
): Promise<CreateProjectPlanResult> {
  return runSerializableTransaction(prisma, async (tx) => {
    const org = await tx.organization.findFirst({
      where: { id: organizationId, deleted_at: null },
      select: { plan_tier: true },
    });
    if (!org) {
      return { ok: false, error: "Organization not found.", code: "org_not_found" };
    }
    const limits = limitsForPlan(org.plan_tier);
    const n = await tx.project.count({
      where: { organization_id: organizationId, deleted_at: null },
    });
    if (n >= limits.maxProjectsPerOrg) {
      return { ok: false, error: PROJECT_LIMIT, code: "max_projects_per_org" };
    }
    const project = await tx.project.create({
      data: {
        organization_id: organizationId,
        name: data.name,
        slug: data.slug,
      },
      select: { id: true, name: true, slug: true, organization_id: true },
    });
    return { ok: true, project };
  });
}

export type CreateApiKeyPlanResult =
  | { ok: true }
  | { ok: false; error: string; code: "project_not_found" | "max_api_keys_per_project" };

/**
 * Count + insert under serializable isolation so concurrent creates cannot exceed the plan cap.
 */
export async function createApiKeyWithPlanLimitCheck(
  prisma: PrismaClient,
  projectId: string,
  data: {
    public_id: string;
    secret_hash: string;
    name: string | null;
    allowed_app: string | null;
  }
): Promise<CreateApiKeyPlanResult> {
  return runSerializableTransaction(prisma, async (tx) => {
    const proj = await tx.project.findFirst({
      where: { id: projectId, deleted_at: null },
      select: {
        organization: { select: { plan_tier: true, deleted_at: true } },
      },
    });
    if (!proj || proj.organization.deleted_at) {
      return { ok: false, error: "Project not found.", code: "project_not_found" };
    }
    const limits = limitsForPlan(proj.organization.plan_tier);
    const n = await tx.apiKey.count({
      where: {
        project_id: projectId,
        deleted_at: null,
        revoked_at: null,
      },
    });
    if (n >= limits.maxApiKeysPerProject) {
      return { ok: false, error: KEY_LIMIT, code: "max_api_keys_per_project" };
    }
    await tx.apiKey.create({
      data: {
        project_id: projectId,
        public_id: data.public_id,
        secret_hash: data.secret_hash,
        name: data.name,
        allowed_app: data.allowed_app,
      },
    });
    return { ok: true };
  });
}
