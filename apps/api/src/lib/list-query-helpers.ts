import { Prisma } from "@prisma/client";
import { escapeLikePattern } from "./list-query.js";
import { releaseFilterMatchSql } from "./release-key.js";

/**
 * Free-text match shared by Global Search View all and list `q` params:
 * each whitespace term must ILIKE at least one column (OR), AND across terms.
 */
export function freeTextAndMatchSql(
  q: string | undefined | null,
  columnExprs: Prisma.Sql[]
): Prisma.Sql | null {
  const terms = (q ?? "").trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0 || columnExprs.length === 0) return null;
  const termClauses = terms.map((term) => {
    const pat = `%${escapeLikePattern(term)}%`;
    const ors = columnExprs.map(
      (col) => Prisma.sql`COALESCE(${col}, '') ILIKE ${pat} ESCAPE '\\'`
    );
    return Prisma.sql`(${Prisma.join(ors, " OR ")})`;
  });
  return Prisma.join(termClauses, " AND ");
}

/**
 * Free-text event match (Global Search / Events `q`): each whitespace term must
 * match `name` OR `properties` (ILIKE), AND across terms.
 */
/**
 * Issues / global error search: each term matches the group message, the
 * fingerprint, or an occurrence's `context.digest` (Next.js error reference).
 */
export function errorGroupTermsMatchSql(
  terms: readonly string[],
  messageCol: Prisma.Sql,
  fingerprintCol: Prisma.Sql,
  errorGroupIdCol: Prisma.Sql
): Prisma.Sql | null {
  const usable = terms.map((term) => term.trim()).filter(Boolean);
  if (usable.length === 0) return null;
  const termClauses = usable.map((term) => {
    const pat = `%${escapeLikePattern(term)}%`;
    return Prisma.sql`(
      COALESCE(${messageCol}, '') ILIKE ${pat} ESCAPE '\\'
      OR COALESCE(${fingerprintCol}, '') ILIKE ${pat} ESCAPE '\\'
      OR EXISTS (
        SELECT 1 FROM "ErrorOccurrence" occ
        WHERE occ."error_group_id" = ${errorGroupIdCol}
          AND COALESCE(occ."context"->>'digest', '') ILIKE ${pat} ESCAPE '\\'
      )
    )`;
  });
  return Prisma.join(termClauses, " AND ");
}

export function errorGroupFreeTextMatchSql(
  q: string | undefined | null,
  messageCol: Prisma.Sql,
  fingerprintCol: Prisma.Sql,
  errorGroupIdCol: Prisma.Sql
): Prisma.Sql | null {
  const terms = (q ?? "").trim().split(/\s+/).filter(Boolean);
  return errorGroupTermsMatchSql(terms, messageCol, fingerprintCol, errorGroupIdCol);
}

export function eventFreeTextMatchSql(
  q: string | undefined | null,
  nameCol: Prisma.Sql = Prisma.sql`name`,
  propertiesCol: Prisma.Sql = Prisma.sql`properties::text`
): Prisma.Sql | null {
  return freeTextAndMatchSql(q, [nameCol, propertiesCol]);
}

export function buildEventWhereSql(params: {
  projectId: string;
  appId?: string;
  name?: string;
  environment?: string;
  platform?: string;
  release?: string;
  gte?: Date;
  lte?: Date;
  propertiesContains?: string;
  /** Free text: each term matches name OR properties (AND across terms). */
  q?: string;
}): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`project_id = ${params.projectId}`];
  if (params.appId) parts.push(Prisma.sql`app = ${params.appId}`);
  if (params.name) parts.push(Prisma.sql`name = ${params.name}`);
  if (params.environment) parts.push(Prisma.sql`environment = ${params.environment}`);
  if (params.platform) parts.push(Prisma.sql`platform = ${params.platform}`);
  if (params.release) parts.push(releaseFilterMatchSql(Prisma.sql`release`, params.release));
  if (params.gte) parts.push(Prisma.sql`created_at >= ${params.gte}`);
  if (params.lte) parts.push(Prisma.sql`created_at <= ${params.lte}`);
  if (params.propertiesContains?.trim()) {
    const pat = `%${escapeLikePattern(params.propertiesContains.trim())}%`;
    parts.push(Prisma.sql`properties::text ILIKE ${pat} ESCAPE '\\'`);
  }
  const freeText = eventFreeTextMatchSql(params.q);
  if (freeText) parts.push(freeText);
  return Prisma.join(parts, " AND ");
}
