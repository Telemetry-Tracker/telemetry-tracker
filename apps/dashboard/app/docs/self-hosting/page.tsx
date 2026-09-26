import type { Metadata } from "next";
import { DocsAlsoSee } from "@/app/components/docs/DocsAlsoSee";
import { DocsArticle } from "@/app/components/docs/DocsArticle";

export const metadata: Metadata = {
  title: "Self-hosting",
  description:
    "What is and is not included when you self-host Telemetry Tracker: PostgreSQL, the API process, and the dashboard image.",
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
          <code>pnpm --filter api build</code>, with <code>DATABASE_URL</code> set. It applies
          migrations before it listens.
        </li>
        <li>
          Scheduled alert rules need a separate cron:{" "}
          <code>node dist/jobs/run-alert-rules-evaluator.js</code> every 5 minutes. Retention is a
          separate nightly job.
        </li>
      </ul>

      <h2>What this is not</h2>
      <p>
        A measured RAM or CPU figure for a small production deployment is not published here. That
        measurement needs a running API, dashboard, and Postgres under a known ingest load, and this
        repository does not yet ship that stack as one Compose file.
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
