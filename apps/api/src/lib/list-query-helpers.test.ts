import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  buildEventWhereSql,
  errorGroupFreeTextMatchSql,
  freeTextAndMatchSql,
} from "./list-query-helpers.js";
import { UNKNOWN_RELEASE_KEY } from "./release-key.js";

function prismaSqlText(fragment: Prisma.Sql): string {
  const parts = fragment as unknown as { strings: string[]; values: unknown[] };
  return parts.strings.join("?");
}

describe("freeTextAndMatchSql", () => {
  it("returns null for blank q", () => {
    expect(freeTextAndMatchSql("   ", [Prisma.sql`col`])).toBeNull();
  });

  it("ANDs whitespace terms across OR columns", () => {
    const sql = freeTextAndMatchSql("foo bar", [
      Prisma.sql`a`,
      Prisma.sql`b`,
    ]);
    expect(sql).not.toBeNull();
    const text = prismaSqlText(sql!);
    expect(text).toContain(" AND ");
    expect(text).toContain(" OR ");
    const values = (sql as unknown as { values: unknown[] }).values;
    expect(values).toContain("%foo%");
    expect(values).toContain("%bar%");
  });
});

describe("errorGroupFreeTextMatchSql", () => {
  it("matches message, fingerprint, and context.digest for each term", () => {
    const sql = errorGroupFreeTextMatchSql(
      "2474318592",
      Prisma.sql`eg."message"`,
      Prisma.sql`eg."fingerprint"`,
      Prisma.sql`eg."id"`
    );
    expect(sql).not.toBeNull();
    const text = prismaSqlText(sql!);
    expect(text).toContain(`occ."context"->>'digest'`);
    expect(text).toContain('occ."error_group_id" = ');
    expect((sql as unknown as { values: unknown[] }).values).toContain("%2474318592%");
  });
});

describe("buildEventWhereSql", () => {
  it("escapes propertiesContains wildcards for ILIKE", () => {
    const sql = buildEventWhereSql({
      projectId: "proj_1",
      propertiesContains: "100%_done",
    });
    expect(prismaSqlText(sql)).toContain("ESCAPE");
    const parts = sql as unknown as { values: unknown[] };
    expect(parts.values).toContain("%100\\%\\_done%");
  });

  it("applies free-text q as AND of name OR properties terms", () => {
    const sql = buildEventWhereSql({
      projectId: "proj_1",
      q: "checkout started",
    });
    const text = prismaSqlText(sql);
    expect(text).toContain("ILIKE");
    expect(text).toContain(" OR ");
    expect(text).toContain(" AND ");
    const values = (sql as unknown as { values: unknown[] }).values;
    expect(values).toContain("%checkout%");
    expect(values).toContain("%started%");
  });

  it("matches Unknown via null / blank / sentinel (not exact __unknown__ only)", () => {
    const sql = buildEventWhereSql({
      projectId: "proj_1",
      release: UNKNOWN_RELEASE_KEY,
    });
    const text = prismaSqlText(sql);
    expect(text).toContain("IS NULL");
    expect(text).toContain("TRIM");
    expect(text).toContain("OR");
    const values = (sql as unknown as { values: unknown[] }).values;
    expect(values).toContain("proj_1");
    expect(values).toContain(UNKNOWN_RELEASE_KEY);
  });

  it("uses TRIM equality for known releases", () => {
    const sql = buildEventWhereSql({
      projectId: "proj_1",
      release: "  1.2.3  ",
    });
    const text = prismaSqlText(sql);
    expect(text).toContain("TRIM");
    expect(text).not.toContain("IS NULL");
    expect((sql as unknown as { values: unknown[] }).values).toContain("1.2.3");
  });
});
