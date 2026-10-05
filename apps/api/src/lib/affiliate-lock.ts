/**
 * Shared row lock for affiliate ledger mutations (mark-as-paid, refunds, disputes).
 */
import { Prisma } from "@prisma/client";

export async function lockAffiliateForUpdate(
  tx: Prisma.TransactionClient,
  affiliateId: string
): Promise<void> {
  await tx.$executeRaw(
    Prisma.sql`SELECT 1 FROM "Affiliate" WHERE id = ${affiliateId} FOR UPDATE`
  );
}
