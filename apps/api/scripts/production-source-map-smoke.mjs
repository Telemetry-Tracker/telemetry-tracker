/**
 * Production checks for the source_map_upload column. Never prints secrets.
 * Usage: node scripts/production-source-map-smoke.mjs verify|smoke
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const phase = process.argv[2];
const apiBase = (process.env.API_BASE_URL || "https://api.telemetry-tracker.com").replace(/\/$/, "");
const prisma = new PrismaClient();

function hashSecret(publicId, secret) {
  return createHash("sha256").update(`${publicId}:${secret}`, "utf8").digest("hex");
}

function makeKeyMaterial(sourceMapUpload) {
  const publicId = randomBytes(16).toString("hex");
  const secret = randomBytes(32).toString("hex");
  return {
    publicId,
    secretHash: hashSecret(publicId, secret),
    fullKey: `tt_live_${publicId}_${secret}`,
    sourceMapUpload,
  };
}

async function columnReady() {
  const rows = await prisma.$queryRaw`
    SELECT 1 AS ok
    FROM information_schema.columns
    WHERE table_name = 'ApiKey' AND column_name = 'source_map_upload'
  `;
  return Array.isArray(rows) && rows.length === 1;
}

async function post(path, key, body) {
  const res = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key.fullKey,
      "x-project-id": key.projectId,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text: text.slice(0, 180) };
}

async function verify() {
  const ready = await columnReady();
  if (!ready) {
    console.log("migration: MISSING source_map_upload");
    process.exit(1);
  }
  const flagged = await prisma.apiKey.count({
    where: { source_map_upload: true, deleted_at: null, revoked_at: null },
  });
  console.log(`migration: applied source_map_upload=true keys=${flagged}`);
}

async function smoke() {
  if (!(await columnReady())) {
    console.log("smoke: migration missing");
    process.exit(1);
  }
  const project = await prisma.project.findFirst({
    where: { deleted_at: null },
    select: { id: true },
    orderBy: { created_at: "asc" },
  });
  if (!project) {
    console.log("smoke: no project");
    process.exit(1);
  }

  const created = [];
  try {
    for (const upload of [true, false]) {
      const material = makeKeyMaterial(upload);
      await prisma.apiKey.create({
        data: {
          id: randomUUID(),
          project_id: project.id,
          public_id: material.publicId,
          secret_hash: material.secretHash,
          name: upload ? "tt-smoke-upload" : "tt-smoke-ingest-only",
          source_map_upload: upload,
        },
      });
      created.push({ ...material, projectId: project.id, upload });
    }

    const fake = await post("/ingest/event", {
      fullKey: `tt_live_${"a".repeat(32)}_${"b".repeat(32)}`,
      projectId: project.id,
    }, { name: "tt-smoke-unknown-key" });
    console.log(`unknown-key ingest: ${fake.status}`);

    for (const key of created) {
      const ingest = await post("/ingest/event", key, {
        name: "tt-smoke-ingest",
        app: "tt-smoke",
      });
      const map = await post("/api/project/source-maps", key, {
        app: "tt-smoke",
        release: "smoke",
        bundle_url: "https://example.com/tt-smoke.js",
        content: { version: 3, sources: [], mappings: "" },
      });
      console.log(
        `${key.upload ? "upload-key" : "ingest-only"} ingest=${ingest.status} source-map=${map.status}`
      );
    }

    const uploadKey = created.find((key) => key.upload);
    const crash = await runCrash(uploadKey.fullKey);
    console.log(`uncaughtException smoke: exit=${crash}`);
  } finally {
    const ids = created.map((key) => key.publicId);
    if (ids.length > 0) {
      await prisma.apiKey.deleteMany({ where: { public_id: { in: ids } } });
      await prisma.sourceMapArtifact.deleteMany({
        where: { app: "tt-smoke", release: "smoke" },
      });
    }
    console.log("smoke keys removed");
  }
}

function runCrash(apiKey) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { init } from "./packages/telemetry-node/dist/index.js";
         init({ ingestUrl: process.env.API_BASE_URL, apiKey: process.env.TT_SMOKE_KEY, app: "tt-smoke", platform: "node" });
         setTimeout(() => { throw new Error("tt-smoke-uncaught"); }, 50);`,
      ],
      {
        cwd: new URL("../../../", import.meta.url).pathname,
        env: { ...process.env, TT_SMOKE_KEY: apiKey, API_BASE_URL: apiBase },
        stdio: "ignore",
      }
    );
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve("timeout");
    }, 8000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(String(code));
    });
  });
}

try {
  if (phase === "verify") await verify();
  else if (phase === "smoke") await smoke();
  else {
    console.log("usage: verify|smoke");
    process.exit(1);
  }
} finally {
  await prisma.$disconnect();
}
