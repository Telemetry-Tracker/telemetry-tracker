import Link from "next/link";
import {
  SettingsPageBody,
  SettingsPageHeader,
} from "@/app/components/dashboard/settings/SettingsPageHeader";
import { Section, SettingsBtn } from "@/app/components/dashboard/settings/settings-ui";
import { fetchPlatformVersion } from "@/lib/platform-version-server";

export const dynamic = "force-dynamic";

const GITHUB_ISSUES_URL = "https://github.com/Telemetry-Tracker/telemetry-tracker/issues";

export default async function SupportSettingsPage() {
  const version = await fetchPlatformVersion();

  return (
    <>
      <SettingsPageHeader
        title="Contact support"
        description="Get help with Telemetry Tracker — self-hosted or cloud."
      />
      <SettingsPageBody>
        <Section title="Get help">
          <p className="text-[13px] text-muted-foreground">
            Browse the docs, use the contact form, or open a GitHub issue for product questions.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/docs">
              <SettingsBtn variant="default">Documentation</SettingsBtn>
            </Link>
            <Link href="/contact">
              <SettingsBtn variant="primary">Contact form</SettingsBtn>
            </Link>
            <Link href={GITHUB_ISSUES_URL} target="_blank" rel="noopener noreferrer">
              <SettingsBtn variant="outline">GitHub issues</SettingsBtn>
            </Link>
          </div>
        </Section>
        <Section title="System info">
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[
              ["Platform version", version ? `v${version}` : "Unknown"],
              ["Dashboard", "Next.js"],
              ["Region", "Self-hosted"],
              ["Support tier", "Community"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</dt>
                <dd className="mt-1 font-mono text-[12px]">{v}</dd>
              </div>
            ))}
          </dl>
        </Section>
      </SettingsPageBody>
    </>
  );
}
