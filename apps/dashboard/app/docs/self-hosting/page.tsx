import type { Metadata } from "next";
import { DocsAlsoSee } from "@/app/components/docs/DocsAlsoSee";
import { DocsArticle } from "@/app/components/docs/DocsArticle";

export const metadata: Metadata = {
  title: "Self-hosting",
  description:
    "What is included when you self-host Telemetry Tracker (PostgreSQL, the API process, the dashboard image) and measured setup time and resource usage.",
  alternates: { canonical: "./" },
};

export default function DocsSelfHostingPage() {
  return (
    <DocsArticle
      title="Self-hosting"
      lede={
        <p>
          The MIT repository can run on your own machines. There is no single production
          Docker Compose file that starts the API, dashboard, and database together.
        </p>
      }
    >
      <h2>What exists today</h2>
      <ul>
        <li>
          <code>docker compose up -d</code> starts <strong>PostgreSQL only</strong>, for local
          development.
        </li>
        <li>
          The root <code>Dockerfile</code> builds the <strong>dashboard image only</strong>.
        </li>
        <li>
          The API (<code>apps/api</code>) has no Dockerfile. Run it with Node after{" "}
          <code>pnpm --filter api build</code>, with <code>DATABASE_URL</code> set. With{" "}
          <code>NODE_ENV=production</code> in the process environment it applies migrations
          before it listens. The API does not load <code>apps/api/.env</code> itself, so use
          your process manager or <code>node --env-file=.env dist/index.js</code> (Node 20.6+).
        </li>
        <li>
          <code>pnpm --filter … start</code> keeps an extra <code>pnpm</code> process (about 106
          MiB RSS) next to each server. Under a process manager, run{" "}
          <code>node dist/index.js</code> and <code>./node_modules/.bin/next start</code>{" "}
          directly.
        </li>
        <li>
          Scheduled alert rules need a separate cron:{" "}
          <code>node dist/jobs/run-alert-rules-evaluator.js</code> every 5 minutes. Retention is a
          separate nightly job.
        </li>
      </ul>

      <h2>Requirements and resource usage (measured)</h2>
      <p>
        We measured one install of v1.22.6 on 2026-10-19: 8 vCPU, 15.6 GiB RAM, Debian 13, Docker
        26.1.5, Node 20.19.2. Postgres 16 ran from <code>docker-compose.yml</code> with default
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
