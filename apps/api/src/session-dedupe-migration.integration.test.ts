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

    // init() row: earlier started_at, smaller UUID, has initial anonymous_id
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Session" (
        id, project_id, session_id, app, platform, anonymous_id, started_at, 
        sdk_version, user_id
      ) VALUES (
        '${initId}', '${projectId}', '${sessionId}', '${app}', 'react-native', 
        'anon-123', '${initStartedAt.toISOString()}', '1.3.1', 'user-init'
      )
    `);

    // identify() row: later started_at, larger UUID, has DIFFERENT user_id (should win)
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

    // Execute the real migration SQL
    // Execute the actual migration SQL statement by statement
    // Statement 1: DROP INDEX
    await prisma.$executeRawUnsafe(
      'DROP INDEX IF EXISTS "Session_project_id_session_id_key"'
    );

    // Statement 2: CREATE TEMP TABLE
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

    // Statement 3: CTE + UPDATE (single statement!)
    await prisma.$executeRawUnsafe(`
      WITH duplicates AS (
        SELECT 
          s.project_id,
          s.session_id,
          s.app,
          (array_agg(s.user_id ORDER BY s.started_at DESC, s.id DESC) FILTER (WHERE s.user_id IS NOT NULL))[1] AS latest_user_id,
          (array_agg(s.user_email ORDER BY s.started_at DESC, s.id DESC) FILTER (WHERE s.user_email IS NOT NULL))[1] AS latest_user_email,
          (array_agg(s.anonymous_id ORDER BY s.started_at DESC, s.id DESC) FILTER (WHERE s.anonymous_id IS NOT NULL))[1] AS latest_anonymous_id,
          (array_agg(s.country ORDER BY s.started_at DESC, s.id DESC) FILTER (WHERE s.country IS NOT NULL))[1] AS latest_country,
          (array_agg(s.device_browser ORDER BY s.started_at DESC, s.id DESC) FILTER (WHERE s.device_browser IS NOT NULL))[1] AS latest_device_browser,
          (array_agg(s.device_os ORDER BY s.started_at DESC, s.id DESC) FILTER (WHERE s.device_os IS NOT NULL))[1] AS latest_device_os,
          (array_agg(s.sdk_version ORDER BY s.started_at DESC, s.id DESC) FILTER (WHERE s.sdk_version IS NOT NULL))[1] AS latest_sdk_version,
          (array_agg(s.platform ORDER BY s.started_at DESC, s.id DESC) FILTER (WHERE s.platform IS NOT NULL))[1] AS latest_platform,
          (array_agg(s.environment ORDER BY s.started_at DESC, s.id DESC) FILTER (WHERE s.environment IS NOT NULL))[1] AS latest_environment,
          (array_agg(s.release ORDER BY s.started_at DESC, s.id DESC) FILTER (WHERE s.release IS NOT NULL))[1] AS latest_release,
          MAX(s.ended_at) AS latest_ended_at
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
        user_id = COALESCE(k.latest_user_id, s.user_id),
        user_email = COALESCE(k.latest_user_email, s.user_email),
        anonymous_id = COALESCE(k.latest_anonymous_id, s.anonymous_id),
        country = COALESCE(k.latest_country, s.country),
        device_browser = COALESCE(k.latest_device_browser, s.device_browser),
        device_os = COALESCE(k.latest_device_os, s.device_os),
        sdk_version = COALESCE(k.latest_sdk_version, s.sdk_version),
        platform = COALESCE(k.latest_platform, s.platform),
        environment = COALESCE(k.latest_environment, s.environment),
        release = COALESCE(k.latest_release, s.release),
        ended_at = COALESCE(k.latest_ended_at, s.ended_at)
      FROM kept_rows k
      WHERE s.id = k.id
    `);

    // Statement 4: DELETE duplicates
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

    // Statement 5: CREATE UNIQUE INDEX
    await prisma.$executeRawUnsafe(
      'CREATE UNIQUE INDEX "Session_project_id_session_id_app_key" ON "Session"("project_id", "session_id", "app")'
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

    // Verify LATEST non-null values won (identify row came later, so its values should win)
    expect(kept.user_id).toBe("user-456"); // identify row's value (latest) wins over init's 'user-init'
    expect(kept.user_email).toBe("test@example.com"); // from identify row (latest)
    expect(kept.country).toBe("US"); // from identify row (latest)
    expect(kept.device_browser).toBe("Mobile Safari"); // from identify row (latest)
    expect(kept.device_os).toBe("iOS 16"); // from identify row (latest)
    expect(kept.environment).toBe("production"); // from identify row (latest)
    expect(kept.release).toBe("1.0.0"); // from identify row (latest)
    expect(kept.ended_at).toEqual(endedAt); // GREATEST of ended_at

    // Verify fields common to both rows were preserved
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

    // Session 1: earliest started_at, smallest id (should be kept), has user_id 'user-earliest'
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Session" (
        id, project_id, session_id, app, started_at, user_id
      ) VALUES (
        '${keptId}', '${projectId}', '${sessionId}', '${app}',
        '${new Date(baseTime.getTime()).toISOString()}', 'user-earliest'
      )
    `);

    // Session 2: same started_at, larger id, has DIFFERENT user info
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Session" (
        id, project_id, session_id, app, started_at, user_id, user_email, country
      ) VALUES (
        '${id2}', '${projectId}', '${sessionId}', '${app}',
        '${new Date(baseTime.getTime()).toISOString()}', 'user-middle', 
        'user2@example.com', 'CA'
      )
    `);

    // Session 3: later started_at, has DIFFERENT user_id and device_os (should win as latest)
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Session" (
        id, project_id, session_id, app, started_at, user_id, device_os, ended_at
      ) VALUES (
        '${id3}', '${projectId}', '${sessionId}', '${app}',
        '${new Date(baseTime.getTime() + 1000).toISOString()}', 'user-latest', 
        'iOS 17', '${new Date(baseTime.getTime() + 5000).toISOString()}'
      )
    `);

    // Execute the actual migration SQL statement by statement
    // Statement 1: DROP INDEX (already done above)
    
    // Clean up temp table from previous test if it exists
    await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS sessions_to_keep');
    
    // Statement 2: CREATE TEMP TABLE
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

    // Statement 3: CTE + UPDATE (single statement!)
    await prisma.$executeRawUnsafe(`
      WITH duplicates AS (
        SELECT 
          s.project_id,
          s.session_id,
          s.app,
          (array_agg(s.user_id ORDER BY s.started_at DESC, s.id DESC) FILTER (WHERE s.user_id IS NOT NULL))[1] AS latest_user_id,
          (array_agg(s.user_email ORDER BY s.started_at DESC, s.id DESC) FILTER (WHERE s.user_email IS NOT NULL))[1] AS latest_user_email,
          (array_agg(s.anonymous_id ORDER BY s.started_at DESC, s.id DESC) FILTER (WHERE s.anonymous_id IS NOT NULL))[1] AS latest_anonymous_id,
          (array_agg(s.country ORDER BY s.started_at DESC, s.id DESC) FILTER (WHERE s.country IS NOT NULL))[1] AS latest_country,
          (array_agg(s.device_browser ORDER BY s.started_at DESC, s.id DESC) FILTER (WHERE s.device_browser IS NOT NULL))[1] AS latest_device_browser,
          (array_agg(s.device_os ORDER BY s.started_at DESC, s.id DESC) FILTER (WHERE s.device_os IS NOT NULL))[1] AS latest_device_os,
          (array_agg(s.sdk_version ORDER BY s.started_at DESC, s.id DESC) FILTER (WHERE s.sdk_version IS NOT NULL))[1] AS latest_sdk_version,
          (array_agg(s.platform ORDER BY s.started_at DESC, s.id DESC) FILTER (WHERE s.platform IS NOT NULL))[1] AS latest_platform,
          (array_agg(s.environment ORDER BY s.started_at DESC, s.id DESC) FILTER (WHERE s.environment IS NOT NULL))[1] AS latest_environment,
          (array_agg(s.release ORDER BY s.started_at DESC, s.id DESC) FILTER (WHERE s.release IS NOT NULL))[1] AS latest_release,
          MAX(s.ended_at) AS latest_ended_at
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
        user_id = COALESCE(k.latest_user_id, s.user_id),
        user_email = COALESCE(k.latest_user_email, s.user_email),
        anonymous_id = COALESCE(k.latest_anonymous_id, s.anonymous_id),
        country = COALESCE(k.latest_country, s.country),
        device_browser = COALESCE(k.latest_device_browser, s.device_browser),
        device_os = COALESCE(k.latest_device_os, s.device_os),
        sdk_version = COALESCE(k.latest_sdk_version, s.sdk_version),
        platform = COALESCE(k.latest_platform, s.platform),
        environment = COALESCE(k.latest_environment, s.environment),
        release = COALESCE(k.latest_release, s.release),
        ended_at = COALESCE(k.latest_ended_at, s.ended_at)
      FROM kept_rows k
      WHERE s.id = k.id
    `);

    // Statement 4: DELETE duplicates
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

    // Statement 5: CREATE UNIQUE INDEX
    await prisma.$executeRawUnsafe(
      'CREATE UNIQUE INDEX "Session_project_id_session_id_app_key" ON "Session"("project_id", "session_id", "app")'
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
    expect(result[0]!.id).toBe(keptId); // earliest by (started_at, id)

    // Verify LATEST non-null values won (session 3 came latest at baseTime + 1000ms)
    expect(result[0]!.user_id).toBe("user-latest"); // from session 3 (latest)
    expect(result[0]!.user_email).toBe("user2@example.com"); // from session 2 (session 3 had none)
    expect(result[0]!.country).toBe("CA"); // from session 2 (session 3 had none)
    expect(result[0]!.device_os).toBe("iOS 17"); // from session 3 (latest)
    expect(result[0]!.ended_at).toEqual(new Date(baseTime.getTime() + 5000)); // GREATEST from session 3
  });

  it("upsert updates with new values and preserves existing non-null fields", async () => {
    const sessionId = randomBytes(16).toString("hex");
    const app = "upsert-test-app";

    // Clean up from previous tests: drop constraint, delete old rows, recreate constraint
    await prisma.$executeRawUnsafe(
      'DROP INDEX IF EXISTS "Session_project_id_session_id_app_key"'
    );
    
    // Delete any leftover sessions from previous tests to avoid constraint violations
    await prisma.$executeRawUnsafe(`
      DELETE FROM "Session" WHERE project_id = '${projectId}'
    `);
    
    // Recreate the unique constraint (required for ON CONFLICT)
    await prisma.$executeRawUnsafe(
      'CREATE UNIQUE INDEX "Session_project_id_session_id_app_key" ON "Session"("project_id", "session_id", "app")'
    );

    // Step 1: Create initial session with user_id "user-1" via raw SQL (simulating init + identify)
    const startedAt = new Date("2026-10-28T12:00:00Z");
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Session" (
        id, project_id, session_id, app, user_id, user_email, country, started_at
      ) VALUES (
        gen_random_uuid(), '${projectId}', '${sessionId}', '${app}',
        'user-1', 'user1@example.com', 'US', '${startedAt.toISOString()}'
      )
    `);

    // Verify initial state
    let session = await prisma.session.findFirst({
      where: { project_id: projectId!, session_id: sessionId, app },
    });
    expect(session).not.toBeNull();
    expect(session!.user_id).toBe("user-1");
    expect(session!.user_email).toBe("user1@example.com");
    expect(session!.country).toBe("US");

    // Step 2: Upsert with DIFFERENT user_id (should update to "user-2")
    await prisma.$executeRaw`
      INSERT INTO "Session" (
        id, project_id, session_id, app, platform, environment, release,
        user_id, user_email, anonymous_id, country, device_browser, device_os,
        sdk_version, started_at, ended_at
      ) VALUES (
        gen_random_uuid(), ${projectId}, ${sessionId}, ${app},
        ${"react-native"}, ${"production"}, ${"2.0.0"},
        ${"user-2"}, ${"user2@example.com"}, ${null}, ${"CA"},
        ${null}, ${null}, ${"1.3.1"}, ${startedAt}, ${null}
      )
      ON CONFLICT (project_id, session_id, app) DO UPDATE SET
        user_id = COALESCE(EXCLUDED.user_id, "Session".user_id),
        user_email = COALESCE(EXCLUDED.user_email, "Session".user_email),
        anonymous_id = COALESCE(EXCLUDED.anonymous_id, "Session".anonymous_id),
        country = COALESCE(EXCLUDED.country, "Session".country),
        device_browser = COALESCE(EXCLUDED.device_browser, "Session".device_browser),
        device_os = COALESCE(EXCLUDED.device_os, "Session".device_os),
        sdk_version = COALESCE(EXCLUDED.sdk_version, "Session".sdk_version),
        platform = COALESCE(EXCLUDED.platform, "Session".platform),
        environment = COALESCE(EXCLUDED.environment, "Session".environment),
        release = COALESCE(EXCLUDED.release, "Session".release),
        ended_at = GREATEST("Session".ended_at, EXCLUDED.ended_at)
    `;

    // Verify user_id was updated to "user-2"
    session = await prisma.session.findFirst({
      where: { project_id: projectId!, session_id: sessionId, app },
    });
    expect(session).not.toBeNull();
    expect(session!.user_id).toBe("user-2"); // updated
    expect(session!.user_email).toBe("user2@example.com"); // updated
    expect(session!.country).toBe("CA"); // updated
    expect(session!.release).toBe("2.0.0"); // new field set

    // Step 3: Upsert WITHOUT user_id (should preserve "user-2", not null it)
    await prisma.$executeRaw`
      INSERT INTO "Session" (
        id, project_id, session_id, app, platform, environment, release,
        user_id, user_email, anonymous_id, country, device_browser, device_os,
        sdk_version, started_at, ended_at
      ) VALUES (
        gen_random_uuid(), ${projectId}, ${sessionId}, ${app},
        ${"react-native"}, ${"production"}, ${"2.1.0"},
        ${null}, ${null}, ${null}, ${null},
        ${null}, ${null}, ${"1.3.1"}, ${startedAt}, ${null}
      )
      ON CONFLICT (project_id, session_id, app) DO UPDATE SET
        user_id = COALESCE(EXCLUDED.user_id, "Session".user_id),
        user_email = COALESCE(EXCLUDED.user_email, "Session".user_email),
        anonymous_id = COALESCE(EXCLUDED.anonymous_id, "Session".anonymous_id),
        country = COALESCE(EXCLUDED.country, "Session".country),
        device_browser = COALESCE(EXCLUDED.device_browser, "Session".device_browser),
        device_os = COALESCE(EXCLUDED.device_os, "Session".device_os),
        sdk_version = COALESCE(EXCLUDED.sdk_version, "Session".sdk_version),
        platform = COALESCE(EXCLUDED.platform, "Session".platform),
        environment = COALESCE(EXCLUDED.environment, "Session".environment),
        release = COALESCE(EXCLUDED.release, "Session".release),
        ended_at = GREATEST("Session".ended_at, EXCLUDED.ended_at)
    `;

    // Verify user_id, user_email, and country were preserved (not nulled)
    session = await prisma.session.findFirst({
      where: { project_id: projectId!, session_id: sessionId, app },
    });
    expect(session).not.toBeNull();
    expect(session!.user_id).toBe("user-2"); // preserved (not nulled)
    expect(session!.user_email).toBe("user2@example.com"); // preserved
    expect(session!.country).toBe("CA"); // preserved
    expect(session!.release).toBe("2.1.0"); // updated to new value
  });
});
