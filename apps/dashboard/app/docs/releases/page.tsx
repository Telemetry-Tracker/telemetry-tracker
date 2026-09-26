import type { Metadata } from "next";
import Link from "next/link";
import { ChangelogReleases } from "@/app/components/docs/ChangelogReleases";
import { DocsArticle } from "@/app/components/docs/DocsArticle";
import { GITHUB_RELEASES_BASE, loadChangelog } from "@/lib/changelog";

export const metadata: Metadata = {
  title: "Release notes",
  description:
    "Platform release history for Telemetry Tracker (API + dashboard). See what shipped in each semver version.",
  alternates: { canonical: "./" },
  openGraph: {
    title: "Release notes — Telemetry Tracker",
    description: "Version history for the Telemetry Tracker platform (API + dashboard).",
  },
};

export default function DocsReleasesPage() {
  const releases = loadChangelog();
  const latest = releases.find((r) => !r.prerelease);

  return (
    <DocsArticle
      title="Release notes"
      lede={
        <p>
          Semver history for the <strong className="text-foreground">platform</strong> (API +
          dashboard). SDK packages (<code className="text-foreground">@telemetry-tracker/*</code>)
          version independently on{" "}
          <a
            href="https://www.npmjs.com/org/telemetry-tracker"
            className="text-brand hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            npm
          </a>
          . Source of truth:{" "}
          <a
            href="https://github.com/Telemetry-Tracker/telemetry-tracker/blob/main/CHANGELOG.md"
            className="text-brand hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            CHANGELOG.md
          </a>{" "}
          in the repository.
        </p>
      }
    >
      <p className="text-sm text-muted-foreground">
        {latest ? (
          <>
            Latest tagged release:{" "}
            <Link
              href={`${GITHUB_RELEASES_BASE}/v${latest.version}`}
              className="text-brand hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              v{latest.version}
            </Link>
            {latest.date ? <> ({latest.date})</> : null}.{" "}
          </>
        ) : null}
        Self-hosted upgrades: see{" "}
        <Link href="/docs/self-hosting" className="text-brand hover:underline">
          Self-hosting
        </Link>{" "}
        and{" "}
        <a
          href="https://github.com/Telemetry-Tracker/telemetry-tracker/blob/main/docs/RELEASE.md"
          className="text-brand hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          docs/RELEASE.md
        </a>
        .
      </p>

      <ChangelogReleases releases={releases} />
    </DocsArticle>
  );
}
