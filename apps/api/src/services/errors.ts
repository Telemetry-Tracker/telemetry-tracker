import type { Prisma, PrismaClient } from "@prisma/client";

export function computeFingerprint(message: string, stack?: string): string {
  const firstLine = stack?.split("\n")[0]?.trim() ?? "";
  return `${message}\n${firstLine}`;
}

export async function findOrCreateErrorGroup(
  prisma: PrismaClient | Prisma.TransactionClient,
  data: {
    projectId: string;
    fingerprint: string;
    message: string;
    top_stack: string | null;
    app: string;
    environment?: string | null;
  }
) {
  const existing = await prisma.errorGroup.findUnique({
    where: {
      project_id_fingerprint: {
        project_id: data.projectId,
        fingerprint: data.fingerprint,
      },
    },
  });
  if (existing) {
    await prisma.errorGroup.update({
      where: { id: existing.id },
      data: {
        occurrences: { increment: 1 },
        last_seen: new Date(),
        ...(data.environment != null && data.environment !== ""
          ? { environment: data.environment }
          : {}),
      },
    });
    return existing;
  }
  return prisma.errorGroup.create({
    data: {
      project_id: data.projectId,
      fingerprint: data.fingerprint,
      message: data.message,
      top_stack: data.top_stack,
      app: data.app,
      environment: data.environment ?? null,
      occurrences: 1,
    },
  });
}
