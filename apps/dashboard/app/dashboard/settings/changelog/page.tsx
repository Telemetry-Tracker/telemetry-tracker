import Link from "next/link";
import { ChangelogReleases } from "@/app/components/docs/ChangelogReleases";
import {
  SettingsPageBody,
  SettingsPageHeader,
} from "@/app/components/dashboard/settings/SettingsPageHeader";
import { GITHUB_RELEASES_BASE, loadChangelog } from "@/lib/changelog";

export const dynamic = "force-dynamic";

export default function ChangelogSettingsPage() {
  const releases = loadChangelog();
  const latest = releases.find((r) => !r.prerelease);
  const recent = releases.filter((r) => !r.prerelease).slice(0, 6);

  return (
    <>
      <SettingsPageHeader
        title="What's new"
        description="Recent platform releases for Telemetry Tracker."
      />
      <SettingsPageBody>
        {latest ? (
          <p className="text-[13px] text-muted-foreground">
            Latest release:{" "}
            <Link
              href={`${GITHUB_RELEASES_BASE}/v${latest.version}`}
              className="text-brand hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              v{latest.version}
            </Link>
            {latest.date ? <> ({latest.date})</> : null}.
          </p>
        ) : null}
        <ChangelogReleases releases={recent} />
        <p className="text-[13px] text-muted-foreground">
          Full history in{" "}
          <Link href="/docs/releases" className="text-brand hover:underline">
            release notes
          </Link>{" "}
          or on{" "}
          <Link
            href="https://github.com/Telemetry-Tracker/telemetry-tracker/blob/main/CHANGELOG.md"
            className="text-brand hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </Link>
          .
        </p>
      </SettingsPageBody>
    </>
  );
}
