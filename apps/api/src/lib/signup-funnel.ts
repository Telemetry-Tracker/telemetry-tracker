import type { PrismaClient } from "@prisma/client";

/** Atomic set-once receipt time; no raw telemetry retention can erase this fact. */
export async function recordFirstTelemetry(prisma: PrismaClient, projectId: string): Promise<void> {
  await prisma.project.updateMany({
    where: { id: projectId, first_event_at: null },
    data: { first_event_at: new Date() },
  });
}
