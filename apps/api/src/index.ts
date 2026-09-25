import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { isTransactionalEmailConfigured } from "./lib/email.js";
import { initSentryIfConfigured } from "./lib/observability.js";

/** Apply pending migrations before listen so a new revision cannot serve without them. */
function migrateDeployBeforeListen(): void {
  if (process.env.NODE_ENV !== "production") return;
  const require = createRequire(import.meta.url);
  let prismaEntry: string;
  try {
    prismaEntry = require.resolve("prisma/build/index.js");
  } catch {
    console.error("[api] prisma CLI is not installed; refusing to listen before migrate deploy");
    process.exit(1);
  }
  console.log("[api] prisma migrate deploy");
  execFileSync(process.execPath, [prismaEntry, "migrate", "deploy"], {
    stdio: "inherit",
    env: process.env,
  });
}

migrateDeployBeforeListen();

/** Sentry must init before any module that should be auto-instrumented (http, pg, …). Static imports of `./app.js` would load Fastify/Prisma/routes first. */
await initSentryIfConfigured();

const { createApp } = await import("./app.js");

const port = Number(process.env.PORT) || 3001;
// Railway proxy often connects via IPv4; 0.0.0.0 avoids "connection refused" 502. Override with HOST=:: if needed.
const host = process.env.HOST ?? "0.0.0.0";
console.log("[api] PORT from env:", process.env.PORT, "HOST:", host, "-> listening on port", port);

try {
  const app = await createApp();
  await app.listen({ port, host });
  // Railway proxy: Node’s default timeouts are too low and can cause 502 “connection refused”
  const nodeServer = app.server as { keepAliveTimeout?: number; headersTimeout?: number } | undefined;
  if (nodeServer) {
    nodeServer.keepAliveTimeout = 65000;
    nodeServer.headersTimeout = 66000;
  }
  const addr = (app.server as { address?: () => { address: string; port: number } | null }).address?.();
  console.log("[api] Listening on", addr ? `${addr.address}:${addr.port}` : `port ${port}`);
  if (process.env.NODE_ENV === "production" && !isTransactionalEmailConfigured()) {
    console.warn(
      "[api] Transactional email is not configured (RESEND_API_KEY + TELEMETRY_EMAIL_FROM). " +
        "Invites, password reset, notifications, and contact form delivery will be disabled."
    );
  }
} catch (err) {
  console.error("[api] Startup failed:", err);
  process.exit(1);
}
