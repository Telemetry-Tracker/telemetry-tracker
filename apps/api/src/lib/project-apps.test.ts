import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  countDistinctAppsInProject,
  ensureProjectAppsSeenOnIngest,
  findAppsAlreadyRegisteredInProject,
  isProjectAppFramework,
  registerProjectApp,
  toProjectAppView,
} from "./project-apps.js";

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    projectApp: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
    $queryRaw: vi.fn(),
    ...overrides,
  } as never;
}

describe("isProjectAppFramework", () => {
  it("accepts known frameworks", () => {
    expect(isProjectAppFramework("nextjs")).toBe(true);
    expect(isProjectAppFramework("other")).toBe(true);
    expect(isProjectAppFramework("django")).toBe(false);
  });
});

describe("registerProjectApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects blank names", async () => {
    const prisma = mockPrisma();
    const result = await registerProjectApp(prisma, "p1", { name: "  " }, { maxAppsPerProject: 5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_name");
  });

  it("rejects unknown frameworks", async () => {
    const prisma = mockPrisma();
    const result = await registerProjectApp(
      prisma,
      "p1",
      { name: "web", framework: "django" },
      { maxAppsPerProject: 5 }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_framework");
  });

  it("creates a new registered app", async () => {
    const created = {
      id: "a1",
      project_id: "p1",
      name: "web",
      framework: "nextjs",
      created_at: new Date("2026-01-01"),
      updated_at: new Date("2026-01-01"),
      first_event_at: null,
      deleted_at: null,
    };
    const prisma = mockPrisma();
    (prisma as { projectApp: { findFirst: ReturnType<typeof vi.fn> } }).projectApp.findFirst.mockResolvedValue(
      null
    );
    (prisma as { $queryRaw: ReturnType<typeof vi.fn> }).$queryRaw
      .mockResolvedValueOnce([]) // findAppsAlreadyRegistered
      .mockResolvedValueOnce([{ n: 0n }]); // count
    (prisma as { projectApp: { create: ReturnType<typeof vi.fn> } }).projectApp.create.mockResolvedValue(
      created
    );

    const result = await registerProjectApp(
      prisma,
      "p1",
      { name: " web ", framework: "nextjs" },
      { maxAppsPerProject: 5 }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.created).toBe(true);
      expect(result.app.name).toBe("web");
      expect(toProjectAppView(result.app).connected).toBe(false);
    }
  });

  it("enforces plan app limit for new labels", async () => {
    const prisma = mockPrisma();
    (prisma as { projectApp: { findFirst: ReturnType<typeof vi.fn> } }).projectApp.findFirst.mockResolvedValue(
      null
    );
    (prisma as { $queryRaw: ReturnType<typeof vi.fn> }).$queryRaw
      .mockResolvedValueOnce([]) // not already registered
      .mockResolvedValueOnce([{ n: 5n }]); // at limit

    const result = await registerProjectApp(
      prisma,
      "p1",
      { name: "new-app" },
      { maxAppsPerProject: 5 }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("max_apps_per_project");
  });
});

describe("ensureProjectAppsSeenOnIngest", () => {
  it("creates registry row with first_event_at when missing", async () => {
    const prisma = mockPrisma();
    (prisma as { projectApp: { findUnique: ReturnType<typeof vi.fn> } }).projectApp.findUnique.mockResolvedValue(
      null
    );
    const create = (prisma as { projectApp: { create: ReturnType<typeof vi.fn> } }).projectApp.create;
    create.mockResolvedValue({});
    const seenAt = new Date("2026-02-01T00:00:00Z");
    await ensureProjectAppsSeenOnIngest(prisma, "p1", ["web"], seenAt);
    expect(create).toHaveBeenCalledWith({
      data: { project_id: "p1", name: "web", first_event_at: seenAt },
    });
  });

  it("stamps first_event_at on existing silent app", async () => {
    const prisma = mockPrisma();
    (prisma as { projectApp: { findUnique: ReturnType<typeof vi.fn> } }).projectApp.findUnique.mockResolvedValue({
      id: "a1",
      project_id: "p1",
      name: "web",
      framework: null,
      created_at: new Date(),
      updated_at: new Date(),
      first_event_at: null,
      deleted_at: null,
    });
    const update = (prisma as { projectApp: { update: ReturnType<typeof vi.fn> } }).projectApp.update;
    update.mockResolvedValue({});
    const seenAt = new Date("2026-02-01T00:00:00Z");
    await ensureProjectAppsSeenOnIngest(prisma, "p1", ["web"], seenAt);
    expect(update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { first_event_at: seenAt },
    });
  });
});

describe("findAppsAlreadyRegisteredInProject / countDistinctAppsInProject", () => {
  it("returns normalized set from query", async () => {
    const prisma = mockPrisma();
    (prisma as { $queryRaw: ReturnType<typeof vi.fn> }).$queryRaw.mockResolvedValue([
      { app: " web " },
      { app: "api" },
    ]);
    const set = await findAppsAlreadyRegisteredInProject(prisma, "p1", ["web", "api"]);
    expect(set.has("web")).toBe(true);
    expect(set.has("api")).toBe(true);
  });

  it("counts distinct apps", async () => {
    const prisma = mockPrisma();
    (prisma as { $queryRaw: ReturnType<typeof vi.fn> }).$queryRaw.mockResolvedValue([{ n: 3n }]);
    await expect(countDistinctAppsInProject(prisma, "p1")).resolves.toBe(3);
  });
});
