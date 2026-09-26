import type { Metadata } from "next";
import { CodeBlock } from "@/app/components/docs/CodeBlock";
import { DocsAlsoSee } from "@/app/components/docs/DocsAlsoSee";
import { DocsArticle } from "@/app/components/docs/DocsArticle";

export const metadata: Metadata = {
  title: "Source maps",
  description:
    "Upload source maps so Telemetry Tracker can show original stack frames for minified Next.js, Vite, and Node bundles.",
  alternates: { canonical: "./" },
};

export default function DocsSourceMapsPage() {
  return (
    <DocsArticle
      title="Source maps"
      lede={
        <p>
          Symbolication is display-only. Error grouping still uses the minified stack. Upload one
          JSON map per app, release, and bundle URL.
        </p>
      }
    >
      <h2>What you need</h2>
      <ul>
        <li>A project API key with source map upload enabled. Browser ingest keys cannot upload maps.</li>
        <li>
          The same <code>release</code> string on the SDK and on the upload.
        </li>
        <li>
          A <code>bundle_url</code> that matches the script URL the browser or server loaded,
          including the content hash.
        </li>
      </ul>

      <h2>Next.js</h2>
      <p>
        Webpack (Next.js 15) usually emits a map next to each chunk. Turbopack (Next.js 16) can
        hash the map independently of the chunk. Point the uploader at the build output and let it
        follow the last non-inline <code>sourceMappingURL</code> comment.
      </p>
      <ul>
        <li>
          Local or Node deploy: <code>artifact_path</code> <code>.next</code>, <code>base_url</code>{" "}
          <code>https://your-domain/_next</code>.
        </li>
        <li>
          Vercel: the <code>.next</code> output exists on the build machine, not in the GitHub
          checkout. Run the upload in the same job that built the app, or download the build output
          first. This repository has not been verified against a live Vercel build.
        </li>
      </ul>

      <h2>GitHub Action</h2>
      <p>
        From another repository, pin the composite action to a <strong>full commit SHA</strong>{" "}
        (with a version comment). Tags before <code>v1.17.18</code> ship an older Action without{" "}
        <code>sourceMappingURL</code> support; tags ≤ <code>v1.16.5</code> also interpolated inputs
        into the script — do not use those. Keep the pin updated with Dependabot{" "}
        <code>github-actions</code> (or Renovate) when you intentionally take a newer release.
      </p>
      <CodeBlock
        code={`- uses: Telemetry-Tracker/telemetry-tracker/.github/actions/upload-source-maps@8d00f9d1527783f6365e7c6e2e1f19630920bc6e # v1.17.24
  with:
    api_key: \${{ secrets.TT_API_KEY }}
    project_id: "your-project-uuid"
    release: \${{ github.sha }}
    app: "web"
    artifact_path: ".next"
    base_url: "https://your-domain/_next"`}
      />

      <DocsAlsoSee
        links={[
          { href: "/docs/nextjs", label: "Next.js SDK" },
          { href: "/dashboard/settings/source-maps", label: "Source maps in the dashboard" },
        ]}
      />
    </DocsArticle>
  );
}
