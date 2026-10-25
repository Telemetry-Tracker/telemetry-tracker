import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { recordFirstTelemetry } from "./signup-funnel.js";
describe("first telemetry receipt", () => {
  it("uses an atomic null predicate so subsequent and concurrent receipts cannot overwrite activation", async () => {
    let stored: Date | null = null;
    const updateMany = vi.fn(async ({ where, data }) => {
      expect(where).toEqual({ id: "project", first_event_at: null });
      if (stored !== null) return { count: 0 };
      stored = data.first_event_at;
      return { count: 1 };
    });
    const prisma = { project: { updateMany } } as unknown as PrismaClient;
    await recordFirstTelemetry(prisma, "project");
    const first = stored;
    await Promise.all([recordFirstTelemetry(prisma, "project"), recordFirstTelemetry(prisma, "project")]);
    expect(stored).toBe(first);
    expect(first).toBeInstanceOf(Date);
    expect(updateMany).toHaveBeenCalledTimes(3);
  });
});
