import type { Prisma, PrismaClient } from "@prisma/client";

/** Step 6 — Basic monthly rollup for quota enforcement (`UsageMonthly`). */

/** UTC calendar month `YYYY-MM`. */
export function currentYearMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** Increment monthly ingest counter (best-effort; quota enforcement can read the same row). */
export async function addIngestUnits(
  prisma: PrismaClient | Prisma.TransactionClient,
  projectId: string,
  units: number
): Promise<void> {
  if (units <= 0) return;
  const yearMonth = currentYearMonth();
  await prisma.usageMonthly.upsert({
    where: {
      project_id_year_month: {
        project_id: projectId,
        year_month: yearMonth,
      },
    },
    create: {
      project_id: projectId,
      year_month: yearMonth,
      ingest_units: units,
    },
    update: {
      ingest_units: { increment: units },
    },
  });
}
