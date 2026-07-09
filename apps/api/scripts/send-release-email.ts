import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "../src/lib/db.js";
import {
  buildMarketingUnsubscribeUrl,
  generateMarketingUnsubscribeToken,
  hashMarketingUnsubscribeToken,
} from "../src/lib/marketing-subscriber.js";
import { sendTransactionalEmail, isTransactionalEmailConfigured } from "../src/lib/email.js";
import { isMinorOrMajorBump } from "../src/lib/release-email-semver.js";
import {
  isReleaseEmailBroadcastComplete,
  loadReleaseEmailSentSubscriberIds,
  pendingReleaseEmailRecipients,
  recordReleaseEmailSendReliable,
  revertReleaseEmailUnsubscribeToken,
  stageReleaseEmailUnsubscribeToken,
} from "../src/lib/release-email-send.js";

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");
const SHOW_HELP = process.argv.includes("--help") || process.argv.includes("-h");
const VERSION_ARG = process.argv.find((a) => a.startsWith("--version="))?.split("=")[1]?.trim();
const PREVIOUS_VERSION_ARG = process.argv
  .find((a) => a.startsWith("--previous-version="))
  ?.split("=")[1]
  ?.trim();

const USAGE = `Usage: pnpm exec tsx scripts/send-release-email.ts [options]

Broadcast a product update email to active marketing subscribers via Resend.

Options:
  --version=X.Y.Z           CHANGELOG section to send (required for live send)
  --previous-version=X.Y.Z  Compare against prior tag; skip patch-only unless --force
  --force                   Send even when --previous-version indicates patch-only
  --dry-run                 Print subject, recipient count, and preview; do not send
  --help, -h                Show this help

Examples:
  pnpm exec tsx scripts/send-release-email.ts --dry-run --version=1.4.2
  pnpm exec tsx scripts/send-release-email.ts --version=1.4.2

Requires: DATABASE_URL, RESEND_API_KEY, TELEMETRY_EMAIL_FROM
Optional: TELEMETRY_DASHBOARD_ORIGIN (default https://telemetry-tracker.com)

See docs/MARKETING-EMAIL.md for maintainer workflow.`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function markdownToHtml(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      if (trimmed.startsWith("### ")) {
        return `<h3 style="margin:1.25em 0 0.5em;font-size:16px;">${escapeHtml(trimmed.slice(4))}</h3>`;
      }
      if (trimmed.startsWith("- ")) {
        return `<li>${escapeHtml(trimmed.slice(2))}</li>`;
      }
      return `<p style="margin:0.75em 0;">${escapeHtml(trimmed)}</p>`;
    })
    .filter(Boolean)
    .join("\n");
}

function extractChangelogSection(version: string): string | null {
  const changelogPath = resolve(process.cwd(), "../../CHANGELOG.md");
  const content = readFileSync(changelogPath, "utf8");
  const header = version === "Unreleased" ? "## [Unreleased]" : `## [${version}]`;
  const start = content.indexOf(header);
  if (start === -1) return null;
  const rest = content.slice(start + header.length);
  const nextHeader = rest.search(/\n## \[/);
  const section = (nextHeader === -1 ? rest : rest.slice(0, nextHeader)).trim();
  return section || null;
}

function isResendDomainVerificationError(error: string | undefined): boolean {
  const message = error?.toLowerCase() ?? "";
  return (
    /domain (is )?not verified/.test(message) ||
    message.includes("verify a domain")
  );
}

function changelogPreview(section: string, maxLines = 6): string {
  const lines = section.split("\n").filter((line) => line.trim());
  const preview = lines.slice(0, maxLines).join("\n");
  const suffix = lines.length > maxLines ? `\n... (${lines.length - maxLines} more line(s))` : "";
  return `${preview}${suffix}`;
}

async function main() {
  if (SHOW_HELP) {
    console.log(USAGE);
    return;
  }

  const version = VERSION_ARG ?? "Unreleased";
  if (!DRY_RUN && version === "Unreleased") {
    console.error("Live send requires --version=X.Y.Z (use --dry-run to preview [Unreleased]).");
    console.error(USAGE);
    process.exit(1);
  }

  const section = extractChangelogSection(version);
  if (!section) {
    console.error(`Could not find CHANGELOG section for ${version}`);
    process.exit(1);
  }

  if (PREVIOUS_VERSION_ARG !== undefined && !FORCE) {
    const bump = isMinorOrMajorBump(version, PREVIOUS_VERSION_ARG || null);
    if (!bump.send) {
      console.log(`Skipping release email: ${bump.reason}`);
      if (DRY_RUN) console.log("--dry-run: would not send for patch-only release.");
      return;
    }
    console.log(`Release email bump check: ${bump.reason}`);
  }

  if (!isTransactionalEmailConfigured()) {
    console.error("RESEND_API_KEY and TELEMETRY_EMAIL_FROM must be set.");
    process.exit(1);
  }

  const dashboardOrigin =
    process.env.TELEMETRY_DASHBOARD_ORIGIN?.trim() || "https://telemetry-tracker.com";

  const subscribers = await prisma.marketingSubscriber.findMany({
    where: { unsubscribed_at: null },
    select: { id: true, email: true, unsubscribe_token: true },
    orderBy: { email: "asc" },
  });

  if (subscribers.length === 0) {
    if (DRY_RUN) {
      console.log("--dry-run: would send to 0 subscriber(s).");
      return;
    }
    console.error(
      "No active marketing subscribers. Re-run after subscribers exist; the workflow can be retried safely."
    );
    process.exit(1);
  }

  const subject =
    version === "Unreleased"
      ? "Telemetry Tracker — what's new"
      : `Telemetry Tracker ${version} is out`;

  const bodyHtml = [
    `<p>Hi,</p>`,
    `<p>Here's what's new in Telemetry Tracker${version === "Unreleased" ? "" : ` ${version}`}:</p>`,
    markdownToHtml(section),
    `<p style="margin-top:1.5em;"><a href="${escapeHtml(dashboardOrigin)}/docs/releases">Read full release notes</a></p>`,
  ].join("\n");

  console.log(`Prepared release email for ${subscribers.length} subscriber(s).`);
  console.log(`Subject: ${subject}`);
  console.log(`CHANGELOG [${version}] preview:\n${changelogPreview(section)}`);
  if (DRY_RUN) {
    const alreadySentIds = await loadReleaseEmailSentSubscriberIds(
      prisma,
      version,
      subscribers.map((sub) => sub.id)
    );
    const pending = pendingReleaseEmailRecipients(subscribers, alreadySentIds);
    console.log(
      `--dry-run: would send to ${pending.length}/${subscribers.length} subscriber(s)` +
        (alreadySentIds.size > 0 ? ` (${alreadySentIds.size} already recorded for ${version}).` : ".")
    );
    return;
  }

  const alreadySentIds = await loadReleaseEmailSentSubscriberIds(
    prisma,
    version,
    subscribers.map((sub) => sub.id)
  );
  const pendingSubscribers = pendingReleaseEmailRecipients(subscribers, alreadySentIds);
  if (alreadySentIds.size > 0) {
    console.log(`Resuming ${version}: ${alreadySentIds.size} already sent, ${pendingSubscribers.length} remaining.`);
  }

  let sentThisRun = 0;
  for (const sub of pendingSubscribers) {
    const rawToken = generateMarketingUnsubscribeToken();
    const unsubscribeTokenHash = hashMarketingUnsubscribeToken(rawToken);
    const previousUnsubscribeTokenHash = sub.unsubscribe_token;

    await stageReleaseEmailUnsubscribeToken(prisma, {
      subscriberId: sub.id,
      unsubscribeTokenHash,
    });

    const unsubscribeUrl = buildMarketingUnsubscribeUrl(dashboardOrigin, rawToken);
    const html = [
      bodyHtml,
      `<hr style="margin:2em 0;border:none;border-top:1px solid #eee;" />`,
      `<p style="font-size:12px;color:#666;">`,
      `You received this because you subscribed to Telemetry Tracker product updates.`,
      ` <a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a>`,
      `</p>`,
    ].join("\n");

    const result = await sendTransactionalEmail({ to: sub.email, subject, html });
    if (!result.sent) {
      await revertReleaseEmailUnsubscribeToken(prisma, {
        subscriberId: sub.id,
        previousUnsubscribeTokenHash,
      });
      console.warn(`Failed to send to ${sub.email}:`, result.error ?? result.status);
      if (isResendDomainVerificationError(result.error)) {
        console.error(
          "Resend rejected the sender domain. Set TELEMETRY_EMAIL_FROM to an address on a verified domain " +
            "(hosted cloud: Telemetry Tracker <noreply@tacko.io>). See docs/BILLING.md#production-setup-hosted-cloud."
        );
        process.exit(1);
      }
      continue;
    }

    await recordReleaseEmailSendReliable(prisma, {
      subscriberId: sub.id,
      releaseVersion: version,
    });
    sentThisRun += 1;
  }

  const deliveredTotal = alreadySentIds.size + sentThisRun;
  console.log(
    `Sent ${sentThisRun} release email(s) this run (${deliveredTotal}/${subscribers.length} total for ${version}).`
  );
  if (!isReleaseEmailBroadcastComplete(deliveredTotal, subscribers.length)) {
    console.error(
      `Release email incomplete: ${deliveredTotal}/${subscribers.length} delivered. Re-run after fixing the failure; already-sent subscribers are skipped and failed send attempts restore the prior unsubscribe token.`
    );
    process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
