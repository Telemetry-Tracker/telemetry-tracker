import type { Metadata } from "next";
import { DocsAlsoSee } from "@/app/components/docs/DocsAlsoSee";
import { CodeBlock } from "@/app/components/docs/CodeBlock";
import { DocsArticle } from "@/app/components/docs/DocsArticle";

export const metadata: Metadata = {
  title: "Self-hosting",
  description:
    "Self-host Telemetry Tracker with one docker compose up: PostgreSQL, API and dashboard, with measured setup time and resource usage.",
  alternates: { canonical: "./" },
};

export default function DocsSelfHostingPage() {
  return (
    <DocsArticle
      title="Self-hosting"
      lede={
        <p>
          The MIT repository runs on your own machines. <code>selfhost/</code> starts PostgreSQL,
          the API and the dashboard with one <code>docker compose up -d</code>.
        </p>
      }
    >
      <h2>Docker Compose</h2>
      <p>
        You need Docker with Compose v2.20+ and about 5 GB of free disk for the build. You
        don&apos;t need Node on the host.
      </p>
      <CodeBlock
        caption="Quick start"
        code={`git clone https://github.com/Telemetry-Tracker/telemetry-tracker.git
cd telemetry-tracker/selfhost
cp .env.example .env
# set POSTGRES_PASSWORD, CHECKIN_ENCRYPTION_KEY and DASHBOARD_API_SECRET, each e.g.:
openssl rand -hex 32
docker compose up -d`}
      />
      <ul>
        <li>
          Open <code>http://localhost:3000</code> and register. The first account can always sign
          up, and after that signup is invite-only unless{" "}
          <code>TELEMETRY_ALLOW_REGISTRATION=true</code>. Point SDKs at{" "}
          <code>http://localhost:3001</code>.
        </li>
        <li>
          The API applies database migrations on every start, before it listens. Healthchecks
          start Postgres, then the API, then the dashboard. The API and dashboard run as the
          unprivileged <code>node</code> user.
        </li>
        <li>
          No secrets ship with the stack: Compose refuses to start until the three secrets are set.
          Postgres has no published port. The API and dashboard listen on{" "}
          <code>127.0.0.1</code> only, so put a TLS reverse proxy in front, or set{" "}
          <code>BIND_ADDRESS=0.0.0.0</code>.
        </li>
        <li>
          <code>DASHBOARD_URL</code> is baked into the dashboard image, so rebuild with{" "}
          <code>docker compose up -d --build</code> after changing it. Upgrade with{" "}
          <code>git pull &amp;&amp; docker compose up -d --build</code>.
        </li>
        <li>
          Scheduled alert rules and check-ins: <code>docker compose --profile jobs up -d</code>{" "}
          starts the evaluator. Retention is a nightly{" "}
          <code>docker compose exec api node dist/jobs/run-retention.js</code> from cron.
        </li>
        <li>Images are built locally. We don&apos;t publish prebuilt images yet.</li>
      </ul>

      <h2>Without Docker</h2>
      <ul>
        <li>
          <code>docker compose up -d</code> in the repo root starts <strong>PostgreSQL only</strong>,
          for local development.
        </li>
        <li>
          The root <code>Dockerfile</code> builds the production dashboard image, and{" "}
          <code>apps/api/Dockerfile</code> builds the API image.
        </li>
        <li>
          To run the API with Node, build it with <code>pnpm --filter api build</code> and set{" "}
          <code>DATABASE_URL</code>. With <code>NODE_ENV=production</code> in the process
          environment, it applies migrations before it listens. The API does not load{" "}
          <code>apps/api/.env</code> itself, so use your process manager or{" "}
          <code>node --env-file=.env dist/index.js</code> (Node 20.6+).
        </li>
        <li>
          <code>pnpm --filter … start</code> keeps an extra <code>pnpm</code> process (about 106
          MiB RSS) next to each server. Under a process manager, run{" "}
          <code>node dist/index.js</code> and <code>./node_modules/.bin/next start</code>{" "}
          directly.
        </li>
        <li>
          Scheduled alert rules need the evaluator (
          <code>node dist/jobs/run-alert-rules-evaluator.js</code>) every 5 minutes. Retention is
          a separate nightly job.
        </li>
      </ul>

      <h2>Requirements and resource usage (measured)</h2>
      <p>
        <strong>Docker Compose</strong>, measured on 2026-10-19 (v1.22.7 plus the{" "}
        <code>selfhost/</code> stack) on an 8 vCPU / 15.6 GiB Debian 13 box with Docker 26.1.5.
        The steps were scripted, so time spent reading docs is not included. These numbers come
        from that one setup and are not guarantees.
      </p>
      <ul>
        <li>
          <strong>Cold</strong> (no images, no build cache): clone 3 s, then{" "}
          <code>docker compose up -d</code> took 221 s to pull, build, start and migrate. All
          services were healthy 232 s after <code>up</code>, about 4 minutes from clone.
        </li>
        <li>
          <strong>Cached</strong> (images already built, empty database): healthy 12 s after{" "}
          <code>up</code>. A Node SDK event showed on the Events page 7.5 s after the SDK started
          (the SDK batches events every 5 s).
        </li>
        <li>
          <strong>Idle</strong> (5 min after the last activity, 30 samples): API 77 MiB, dashboard 119 MiB,
          Postgres 65 MiB, 261 MiB in total by <code>docker stats</code>. CPU averaged 0.4% of one
          core. An earlier sample with more frequent healthchecks came to 391 MiB.
        </li>
        <li>
          <strong>Disk:</strong> the API image is 575 MB, the dashboard image 357 MB and{" "}
          <code>postgres:16-alpine</code> 294 MB. The build cache was 3.6 GB (
          <code>docker builder prune</code> reclaims it).
        </li>
      </ul>
      <p>
        <strong>Node processes without Docker:</strong> we measured one install of v1.22.6 on
        2026-10-19: 8 vCPU, 15.6 GiB RAM, Debian 13, Docker 26.1.5, Node 20.19.2. Postgres 16 ran from <code>docker-compose.yml</code> with default
        settings. The API and dashboard ran as Node processes in production mode, with no email,
        billing or Sentry configured. These numbers come from that one setup and are not
        guarantees.
      </p>
      <ul>
        <li>
          <strong>Setup, cold caches:</strong> clone 3 s, <code>pnpm install</code> 15 s,{" "}
          <code>docker compose up -d</code> until Postgres was healthy 11 s,{" "}
          <code>pnpm build</code> 115 s, migrations 2 s, start 2 s. From clone to the first error
          in the dashboard took 4 min 42 s, done as a script, not counting time to read the docs or
          install Node.
        </li>
        <li>
          <strong>Idle</strong>, 5 min after start: API 118 MiB RSS, dashboard 287 MiB RSS,
          Postgres 49 MiB, about 453 MiB in total. CPU stayed near 0%, with short Postgres spikes up to
          about 5% of one core.
        </li>
        <li>
          <strong>Small workload</strong> for 12 min: about 3 events/s, an error with a stack trace
          every 2 s, a session every 10 s, and dashboard page loads every 30 s. Total memory had a
          median of 540 MiB (559 MiB max). CPU had a median of 8.6% of one core (17.6% max), and
          ingest latency was 12.5 ms p50.
        </li>
        <li>
          <strong>Disk:</strong> the <code>postgres:16</code> image is 451 MB, and the dashboard
          image is 1.06 GB. After the workload (2,160 events, 360 errors), the Postgres volume was
          71 MB.
        </li>
      </ul>
      <p>
        RSS counts shared pages more than once, and the Postgres figure is container memory from{" "}
        <code>docker stats</code>. Full method and tables are in <code>DEPLOYMENT.md</code>.
      </p>
      <p>
        Env vars, Railway, and the upgrade checklist are in{" "}
        <code>DEPLOYMENT.md</code> and <code>docs/RAILWAY.md</code> in the repository.
      </p>

      <DocsAlsoSee
        links={[
          { href: "/docs/hosted-cloud", label: "Hosted cloud" },
          { href: "/docs/alerts", label: "Alerts" },
          { href: "/self-hosted-error-tracking", label: "Self-hosted overview" },
        ]}
      />
    </DocsArticle>
  );
}
