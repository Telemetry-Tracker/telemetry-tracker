import type { PrismaClient, ProjectApp } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { normalizeMapAppLabel } from "./source-map-artifact.js";

/** Frameworks with dedicated setup guides under /docs and /error-tracking. */
export const PROJECT_APP_FRAMEWORKS = [
  "nextjs",
  "node",
  "react",
  "react-native",
  "vue",
  "nuxt",
  "nestjs",
  "other",
] as const;

export type ProjectAppFramework = (typeof PROJECT_APP_FRAMEWORKS)[number];

export function isProjectAppFramework(value: string): value is ProjectAppFramework {
  return (PROJECT_APP_FRAMEWORKS as readonly string[]).includes(value);
}

export type ProjectAppView = {
  id: string;
  name: string;
  framework: string | null;
  createdAt: string;
  firstEventAt: string | null;
  connected: boolean;
};

export function toProjectAppView(row: ProjectApp): ProjectAppView {
  return {
    id: row.id,
    name: row.name,
    framework: row.framework,
    createdAt: row.created_at.toISOString(),
    firstEventAt: row.first_event_at?.toISOString() ?? null,
    connected: row.first_event_at != null,
  };
}

/**
 * Distinct SDK app labels: registered ProjectApp rows UNION telemetry.
 * Registered-but-silent apps appear immediately; discovery stays compatible.
 */
export async function distinctAppsForProject(
  prisma: PrismaClient,
  projectId: string
): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ app: string }[]>(Prisma.sql`
    SELECT DISTINCT app FROM (
      SELECT name AS app FROM "ProjectApp"
        WHERE project_id = ${projectId} AND deleted_at IS NULL
      UNION
      SELECT app FROM "Event" WHERE project_id = ${projectId}
      UNION
      SELECT app FROM "ErrorGroup" WHERE project_id = ${projectId}
      UNION
      SELECT app FROM "Session" WHERE project_id = ${projectId}
    ) t
    WHERE TRIM(app) <> ''
    ORDER BY app ASC
  `);
  return rows.map((row) => row.app);
}

/** Count unique app labels (registry + telemetry) for plan enforcement. */
export async function countDistinctAppsInProject(
  prisma: PrismaClient,
  projectId: string
): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM (
      SELECT TRIM(name) AS app FROM "ProjectApp"
        WHERE project_id = ${projectId} AND deleted_at IS NULL
      UNION
      SELECT DISTINCT TRIM(app) AS app FROM "Event" WHERE project_id = ${projectId}
      UNION
      SELECT DISTINCT TRIM(app) AS app FROM "Session" WHERE project_id = ${projectId}
      UNION
      SELECT DISTINCT TRIM(app) AS app FROM "ErrorGroup" WHERE project_id = ${projectId}
    ) AS u
    WHERE app <> ''
  `;
  return Number(rows[0]?.n ?? 0);
}

/**
 * Which of the given labels already exist in ProjectApp or telemetry.
 */
export async function findAppsAlreadyRegisteredInProject(
  prisma: PrismaClient,
  projectId: string,
  appLabels: string[]
): Promise<Set<string>> {
  const unique = [...new Set(appLabels.map(normalizeMapAppLabel).filter(Boolean))];
  if (unique.length === 0) return new Set();
  const inList = Prisma.join(unique.map((a) => Prisma.sql`${a}`));
  const rows = await prisma.$queryRaw<{ app: string }[]>(Prisma.sql`
    SELECT DISTINCT TRIM(app) AS app FROM (
      SELECT name AS app FROM "ProjectApp"
        WHERE project_id = ${projectId}
          AND deleted_at IS NULL
          AND TRIM(name) IN (${inList})
      UNION
      SELECT app FROM "Event" WHERE project_id = ${projectId} AND TRIM(app) IN (${inList})
      UNION
      SELECT app FROM "Session" WHERE project_id = ${projectId} AND TRIM(app) IN (${inList})
      UNION
      SELECT app FROM "ErrorGroup" WHERE project_id = ${projectId} AND TRIM(app) IN (${inList})
    ) AS u
  `);
  return new Set(rows.map((r) => normalizeMapAppLabel(r.app)));
}

export type RegisterProjectAppInput = {
  name: string;
  framework?: string | null;
};

export type RegisterProjectAppResult =
  | { ok: true; app: ProjectApp; created: boolean }
  | { ok: false; error: string; code: "invalid_name" | "invalid_framework" | "max_apps_per_project" };

/**
 * Register (or revive) an app for setup before telemetry.
 * Does not create fake events.
 */
export async function registerProjectApp(
  prisma: PrismaClient,
  projectId: string,
  input: RegisterProjectAppInput,
  limits: { maxAppsPerProject: number }
): Promise<RegisterProjectAppResult> {
  const name = normalizeMapAppLabel(input.name);
  if (!name || name.length > 128) {
    return { ok: false, error: "App name is required (max 128 characters).", code: "invalid_name" };
  }
  const frameworkRaw = input.framework?.trim() || null;
  if (frameworkRaw && !isProjectAppFramework(frameworkRaw)) {
    return {
      ok: false,
      error: `Unsupported framework. Use one of: ${PROJECT_APP_FRAMEWORKS.join(", ")}.`,
      code: "invalid_framework",
    };
  }

  const existing = await prisma.projectApp.findFirst({
    where: { project_id: projectId, name },
  });
  if (existing && !existing.deleted_at) {
    const updated =
      frameworkRaw && frameworkRaw !== existing.framework
        ? await prisma.projectApp.update({
            where: { id: existing.id },
            data: { framework: frameworkRaw },
          })
        : existing;
    return { ok: true, app: updated, created: false };
  }

  const already = await findAppsAlreadyRegisteredInProject(prisma, projectId, [name]);
  if (!already.has(name)) {
    const total = await countDistinctAppsInProject(prisma, projectId);
    if (total + 1 > limits.maxAppsPerProject) {
      return {
        ok: false,
        error: "App limit reached for this project (plan limit).",
        code: "max_apps_per_project",
      };
    }
  }

  if (existing?.deleted_at) {
    const revived = await prisma.projectApp.update({
      where: { id: existing.id },
      data: {
        deleted_at: null,
        framework: frameworkRaw ?? existing.framework,
      },
    });
    return { ok: true, app: revived, created: true };
  }

  const created = await prisma.projectApp.create({
    data: {
      project_id: projectId,
      name,
      framework: frameworkRaw,
    },
  });
  return { ok: true, app: created, created: true };
}

/**
 * After successful ingest, ensure ProjectApp exists and stamp first_event_at.
 * Best-effort; never fails the ingest path.
 */
export async function ensureProjectAppsSeenOnIngest(
  prisma: PrismaClient,
  projectId: string,
  appLabels: string[],
  seenAt: Date = new Date()
): Promise<void> {
  const unique = [...new Set(appLabels.map(normalizeMapAppLabel).filter(Boolean))];
  for (const name of unique) {
    try {
      const existing = await prisma.projectApp.findUnique({
        where: { project_id_name: { project_id: projectId, name } },
      });
      if (!existing) {
        await prisma.projectApp.create({
          data: {
            project_id: projectId,
            name,
            first_event_at: seenAt,
          },
        });
        continue;
      }
      const data: { deleted_at?: null; first_event_at?: Date } = {};
      if (existing.deleted_at) data.deleted_at = null;
      if (!existing.first_event_at) data.first_event_at = seenAt;
      if (Object.keys(data).length > 0) {
        await prisma.projectApp.update({ where: { id: existing.id }, data });
      }
    } catch {
      /* concurrent ingest / plan race — listing still falls back to telemetry UNION */
    }
  }
}

export async function listProjectApps(
  prisma: PrismaClient,
  projectId: string
): Promise<ProjectAppView[]> {
  const rows = await prisma.projectApp.findMany({
    where: { project_id: projectId, deleted_at: null },
    orderBy: { name: "asc" },
  });
  return rows.map(toProjectAppView);
}

export async function softDeleteProjectApp(
  prisma: PrismaClient,
  projectId: string,
  appName: string
): Promise<boolean> {
  const name = normalizeMapAppLabel(appName);
  const result = await prisma.projectApp.updateMany({
    where: { project_id: projectId, name, deleted_at: null },
    data: { deleted_at: new Date() },
  });
  return result.count > 0;
}
