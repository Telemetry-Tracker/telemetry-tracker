import type { PrismaClient } from "@prisma/client";

export function computeFingerprint(message: string, stack?: string): string {
  const firstLine = stack?.split("\n")[0]?.trim() ?? "";
  return `${message}\n${firstLine}`;
}

export async function findOrCreateErrorGroup(
  prisma: PrismaClient,
  data: {
    projectId: string;
    fingerprint: string;
    message: string;
    top_stack: string | null;
    app: string;
    environment?: string | null;
  }
) {
  return prisma.errorGroup.upsert({
    where: {
      project_id_fingerprint: {
        project_id: data.projectId,
        fingerprint: data.fingerprint,
      },
    },
    create: {
      project_id: data.projectId,
      fingerprint: data.fingerprint,
      message: data.message,
      top_stack: data.top_stack,
      app: data.app,
      environment: data.environment ?? null,
      occurrences: 1,
    },
    update: {
      occurrences: { increment: 1 },
      last_seen: new Date(),
      ...(data.environment != null && data.environment !== ""
        ? { environment: data.environment }
        : {}),
    },
  });
}
