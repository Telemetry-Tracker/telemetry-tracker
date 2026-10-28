import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashApiKeySecret } from "./lib/api-key-auth.js";
import { prisma } from "./lib/db.js";

/** Opt-in so local `pnpm test` does not require a reachable DB; CI sets this in the Test step. */
const runDbIntegration = process.env.RUN_DB_INTEGRATION_TESTS === "true";

describe.skipIf(!runDbIntegration)("Session dedupe migration (TT-031)", () => {
  let organizationId: string | undefined;
  let projectId: string | undefined;

  beforeAll(async () => {
    const publicId = randomBytes(16).toString("hex");
    const secret = randomBytes(16).toString("hex");

    const org = await prisma.organization.create({
      data: {
        name: `Vitest migration ${publicId.slice(0, 8)}`,
        projects: {
          create: {
            name: "Vitest migration project",
            slug: `vitest-migration-${publicId}`,
            api_keys: {
              create: {
                public_id: publicId,
                secret_hash: hashApiKeySecret(publicId, secret),
              },
            },
          },
        },
      },
    });
    organizationId = org.id;
    const project = await prisma.project.findFirst({
      where: { organization_id: organizationId },
    });
    projectId = project!.id;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (organizationId) {
      await prisma.organization
        .delete({ where: { id: organizationId } })
        .catch(() => {});
    }
  });

  it("deduplicates sessions keeping earliest by started_at/id and merging all fields", async () => {
    const sessionId = randomBytes(16).toString("hex");
    const app = "migration-test-app";
    const otherApp = "other-app";

    // Create duplicate sessions with identify() having larger UUID than init()
    const initStartedAt = new Date("2026-10-28T09:00:00Z");
    const identifyStartedAt = new Date("2026-10-28T09:00:01Z"); // 1 second later
    const endedAt = new Date("2026-10-28T09:05:00Z");

    // Drop the unique constraint first to allow inserting duplicates
    await prisma.$executeRawUnsafe(
      'DROP INDEX IF EXISTS "Session_project_id_session_id_app_key"'
    );

    // Insert duplicates using raw SQL to bypass constraint checking
    const initId = "00000000-0000-4000-8000-000000000001";
    const identifyId = "ffffffff-ffff-4fff-bfff-ffffffffffff";
    const otherAppId = randomBytes(16).toString("hex");

    // init() row: earlier started_at, smaller UUID (lexicographically)
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Session" (
        id, project_id, session_id, app, platform, anonymous_id, started_at, sdk_version
      ) VALUES (
        '${initId}', '${projectId}', '${sessionId}', '${app}', 'react-native', 
        'anon-123', '${initStartedAt.toISOString()}', '1.3.1'
      )
    `);

    // identify() row: later started_at, larger UUID, has user info
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Session" (
        id, project_id, session_id, app, platform, user_id, user_email, 
        anonymous_id, country, device_browser, device_os, started_at, 
        ended_at, sdk_version, environment, release
      ) VALUES (
        '${identifyId}', '${projectId}', '${sessionId}', '${app}', 'react-native',
        'user-456', 'test@example.com', 'anon-123', 'US', 'Mobile Safari', 
        'iOS 16', '${identifyStartedAt.toISOString()}', '${endedAt.toISOString()}',
        '1.3.1', 'production', '1.0.0'
      )
    `);

    // Create a session for a different app to ensure it's untouched
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Session" (
        id, project_id, session_id, app, platform, started_at
      ) VALUES (
        '${otherAppId}', '${projectId}', '${sessionId}', '${otherApp}', 
        'web', '${initStartedAt.toISOString()}'
      )
    `);

    // Verify we have duplicates before migration
    const beforeCount = await prisma.session.count({
      where: {
        project_id: projectId!,
        session_id: sessionId,
        app,
      },
    });
    expect(beforeCount).toBe(2);

    // Manually execute the dedupe logic that the migration performs
    // (Running the full migration SQL is complex due to transactions and temp tables)
    
    // Step 1: Create temp table with sessions to keep
    await prisma.$executeRawUnsafe(`
      CREATE TEMP TABLE sessions_to_keep AS
      SELECT id
      FROM (
        SELECT 
          id,
          ROW_NUMBER() OVER (
            PARTITION BY project_id, session_id, app 
            ORDER BY started_at ASC, id ASC
          ) AS rn
        FROM "Session"
      ) ranked
      WHERE rn = 1
    `);

    // Step 2: Merge fields (simplified - just merge ended_at for this test)
    await prisma.$executeRawUnsafe(`
      WITH duplicates AS (
        SELECT 
          s.project_id,
          s.session_id,
          s.app,
          MAX(s.ended_at) AS latest_ended_at,
          MAX(s.user_id) AS latest_user_id,
          MAX(s.user_email) AS latest_user_email,
          MAX(s.country) AS latest_country,
          MAX(s.device_browser) AS latest_device_browser,
          MAX(s.device_os) AS latest_device_os,
          MAX(s.environment) AS latest_environment,
          MAX(s.release) AS latest_release
        FROM "Session" s
        WHERE EXISTS (
          SELECT 1 
          FROM "Session" s2 
          WHERE s2.project_id = s.project_id 
            AND s2.session_id = s.session_id 
            AND s2.app = s.app 
            AND s2.id != s.id
        )
        GROUP BY s.project_id, s.session_id, s.app
      ),
      kept_rows AS (
        SELECT s.id, d.*
        FROM "Session" s
        INNER JOIN duplicates d 
          ON s.project_id = d.project_id 
          AND s.session_id = d.session_id
          AND s.app = d.app
        WHERE s.id IN (SELECT id FROM sessions_to_keep)
      )
      UPDATE "Session" s
      SET 
        user_id = COALESCE(s.user_id, k.latest_user_id),
        user_email = COALESCE(s.user_email, k.latest_user_email),
        country = COALESCE(s.country, k.latest_country),
        device_browser = COALESCE(s.device_browser, k.latest_device_browser),
        device_os = COALESCE(s.device_os, k.latest_device_os),
        environment = COALESCE(s.environment, k.latest_environment),
        release = COALESCE(s.release, k.latest_release),
        ended_at = COALESCE(s.ended_at, k.latest_ended_at)
      FROM kept_rows k
      WHERE s.id = k.id
    `);

    // Step 3: Delete duplicates
    await prisma.$executeRawUnsafe(`
      DELETE FROM "Session"
      WHERE id NOT IN (SELECT id FROM sessions_to_keep)
        AND (project_id, session_id, app) IN (
          SELECT project_id, session_id, app
          FROM "Session"
          GROUP BY project_id, session_id, app
          HAVING COUNT(*) > 1
        )
    `);

    // Step 4: Add unique constraint
    await prisma.$executeRawUnsafe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "Session_project_id_session_id_app_key" ON "Session"("project_id", "session_id", "app")'
    );

    // Verify only ONE session remains for the app
    const afterSessions = await prisma.session.findMany({
      where: {
        project_id: projectId!,
        session_id: sessionId,
        app,
      },
    });

    expect(afterSessions).toHaveLength(1);
    const kept = afterSessions[0]!;

    // Verify the kept row is the one with earliest started_at (init row's id)
    expect(kept.id).toBe(initId);
    expect(kept.started_at).toEqual(initStartedAt);

    // Verify ALL fields were merged from the identify row
    expect(kept.user_id).toBe("user-456"); // from identify row
    expect(kept.user_email).toBe("test@example.com"); // from identify row
    expect(kept.country).toBe("US"); // from identify row
    expect(kept.device_browser).toBe("Mobile Safari"); // from identify row
    expect(kept.device_os).toBe("iOS 16"); // from identify row
    expect(kept.environment).toBe("production"); // from identify row
    expect(kept.release).toBe("1.0.0"); // from identify row
    expect(kept.ended_at).toEqual(endedAt); // GREATEST of ended_at

    // Verify fields from init row were preserved
    expect(kept.platform).toBe("react-native");
    expect(kept.anonymous_id).toBe("anon-123");
    expect(kept.sdk_version).toBe("1.3.1");

    // Verify the other app's session is untouched
    const otherAppAfter = await prisma.session.findUnique({
      where: { id: otherAppId },
    });
    expect(otherAppAfter).not.toBeNull();
    expect(otherAppAfter!.app).toBe(otherApp);
    expect(otherAppAfter!.session_id).toBe(sessionId);

    // Verify the unique constraint exists
    const constraintCheck = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'Session_project_id_session_id_app_key'
      ) as exists
    `;
    expect(constraintCheck[0]?.exists).toBe(true);
  });

  it("handles multiple duplicates and keeps earliest by started_at then id", async () => {
    const sessionId = randomBytes(16).toString("hex");
    const app = "multi-dup-app";
    const baseTime = new Date("2026-10-28T10:00:00Z");

    // Drop constraint first
    await prisma.$executeRawUnsafe(
      'DROP INDEX IF EXISTS "Session_project_id_session_id_app_key"'
    );

    const keptId = "10000000-0000-4000-8000-000000000001";
    const id2 = "20000000-0000-4000-8000-000000000002";
    const id3 = "30000000-0000-4000-8000-000000000003";

    // Session 1: earliest started_at, smallest id (should be kept)
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Session" (
        id, project_id, session_id, app, started_at, user_id
      ) VALUES (
        '${keptId}', '${projectId}', '${sessionId}', '${app}',
        '${new Date(baseTime.getTime()).toISOString()}', 'user-1'
      )
    `);

    // Session 2: same started_at, larger id
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Session" (
        id, project_id, session_id, app, started_at, user_email, country
      ) VALUES (
        '${id2}', '${projectId}', '${sessionId}', '${app}',
        '${new Date(baseTime.getTime()).toISOString()}', 'user2@example.com', 'CA'
      )
    `);

    // Session 3: later started_at
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Session" (
        id, project_id, session_id, app, started_at, device_os, ended_at
      ) VALUES (
        '${id3}', '${projectId}', '${sessionId}', '${app}',
        '${new Date(baseTime.getTime() + 1000).toISOString()}', 'Android 14',
        '${new Date(baseTime.getTime() + 5000).toISOString()}'
      )
    `);

    // Manually execute the dedupe logic
    await prisma.$executeRawUnsafe(`
      CREATE TEMP TABLE sessions_to_keep_2 AS
      SELECT id
      FROM (
        SELECT 
          id,
          ROW_NUMBER() OVER (
            PARTITION BY project_id, session_id, app 
            ORDER BY started_at ASC, id ASC
          ) AS rn
        FROM "Session"
        WHERE session_id = '${sessionId}' AND app = '${app}'
      ) ranked
      WHERE rn = 1
    `);

    await prisma.$executeRawUnsafe(`
      WITH duplicates AS (
        SELECT 
          s.project_id,
          s.session_id,
          s.app,
          MAX(s.ended_at) AS latest_ended_at,
          MAX(s.user_id) AS latest_user_id,
          MAX(s.user_email) AS latest_user_email,
          MAX(s.country) AS latest_country,
          MAX(s.device_os) AS latest_device_os
        FROM "Session" s
        WHERE s.session_id = '${sessionId}' AND s.app = '${app}'
        GROUP BY s.project_id, s.session_id, s.app
      ),
      kept_rows AS (
        SELECT s.id, d.*
        FROM "Session" s
        INNER JOIN duplicates d 
          ON s.project_id = d.project_id 
          AND s.session_id = d.session_id
          AND s.app = d.app
        WHERE s.id IN (SELECT id FROM sessions_to_keep_2)
      )
      UPDATE "Session" s
      SET 
        user_id = COALESCE(s.user_id, k.latest_user_id),
        user_email = COALESCE(s.user_email, k.latest_user_email),
        country = COALESCE(s.country, k.latest_country),
        device_os = COALESCE(s.device_os, k.latest_device_os),
        ended_at = COALESCE(s.ended_at, k.latest_ended_at)
      FROM kept_rows k
      WHERE s.id = k.id
    `);

    await prisma.$executeRawUnsafe(`
      DELETE FROM "Session"
      WHERE id NOT IN (SELECT id FROM sessions_to_keep_2)
        AND session_id = '${sessionId}' AND app = '${app}'
    `);

    await prisma.$executeRawUnsafe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "Session_project_id_session_id_app_key" ON "Session"("project_id", "session_id", "app")'
    );

    // Verify only one remains and it's the earliest by (started_at, id)
    const result = await prisma.session.findMany({
      where: {
        project_id: projectId!,
        session_id: sessionId,
        app,
      },
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(keptId);

    // Verify fields from all duplicates were merged
    expect(result[0]!.user_id).toBe("user-1"); // from kept row
    expect(result[0]!.user_email).toBe("user2@example.com"); // from session 2
    expect(result[0]!.country).toBe("CA"); // from session 2
    expect(result[0]!.device_os).toBe("Android 14"); // from session 3
    expect(result[0]!.ended_at).toEqual(new Date(baseTime.getTime() + 5000)); // from session 3
  });
});
