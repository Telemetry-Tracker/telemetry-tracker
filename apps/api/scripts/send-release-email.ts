import { prisma } from "../src/lib/db.js";
import {
  loadChangelogMinorLine,
  loadChangelogSection,
} from "../src/lib/changelog-section.js";
import {
  buildMarketingUnsubscribeUrl,
  generateMarketingUnsubscribeToken,
  hashMarketingUnsubscribeToken,
  isValidMarketingEmail,
  normalizeMarketingEmail,
} from "../src/lib/marketing-subscriber.js";
import { sendTransactionalEmail, isTransactionalEmailConfigured } from "../src/lib/email.js";
import { shouldSendProductUpdateEmail } from "../src/lib/release-email-semver.js";
import {
  emptyReleaseEmailAudienceMessage,
  isReleaseEmailBroadcastComplete,
  loadReleaseEmailSentSubscriberIds,
  pendingReleaseEmailRecipients,
  recordReleaseEmailSendReliable,
  revertReleaseEmailUnsubscribeToken,
  stageReleaseEmailUnsubscribeToken,
} from "../src/lib/release-email-send.js";
import {
  appendReleaseEmailFooter,
  buildReleaseEmailBodyHtml,
} from "../src/lib/release-email-template.js";

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");
const LINE_CLOSE = process.argv.includes("--line-close");
const SHOW_HELP = process.argv.includes("--help") || process.argv.includes("-h");
const VERSION_ARG = process.argv.find((a) => a.startsWith("--version="))?.split("=")[1]?.trim();
const PREVIOUS_VERSION_ARG = process.argv
  .find((a) => a.startsWith("--previous-version="))
  ?.split("=")[1]
  ?.trim();

const TEST_TO_ARG = process.argv.find((a) => a.startsWith("--test-to="))?.split("=")[1]?.trim();

const USAGE = `Usage: pnpm exec tsx scripts/send-release-email.ts [options]

Broadcast a product update email to active marketing subscribers via Resend.

Options:
  --version=X.Y.Z           Closing release tag / CHANGELOG anchor (required for live send)
  --previous-version=X.Y.Z  Last emailed / previous minor final; skip opens & mid-line patches unless --line-close or --force
  --line-close              Send for the whole minor line (all X.Y.* since --previous-version)
  --force                   Send a single-version email even when bump check would skip (not full line)
  --test-to=you@example.com Send one preview message (no ledger, subject prefixed [TEST])
  --dry-run                 Print subject, recipient count, and preview; do not send
  --help, -h                Show this help

Examples:
  pnpm exec tsx scripts/send-release-email.ts --dry-run --version=1.15.4 --previous-version=1.14.4 --line-close
  pnpm exec tsx scripts/send-release-email.ts --version=1.15.4 --previous-version=1.14.4 --line-close
  pnpm exec tsx scripts/send-release-email.ts --test-to=you@example.com --version=1.15.4 --line-close

Requires: DATABASE_URL, RESEND_API_KEY, TELEMETRY_EMAIL_FROM
Optional: TELEMETRY_DASHBOARD_ORIGIN (default https://telemetry-tracker.com)

See docs/MARKETING-EMAIL.md for maintainer workflow.`;

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
  if (!DRY_RUN && !TEST_TO_ARG && version === "Unreleased") {
    console.error("Live send requires --version=X.Y.Z (use --dry-run to preview [Unreleased]).");
    console.error(USAGE);
    process.exit(1);
  }

  if (TEST_TO_ARG && !VERSION_ARG) {
    console.error("--test-to requires --version=X.Y.Z");
    process.exit(1);
  }

  if (LINE_CLOSE && FORCE) {
    console.error("Use either --line-close (full minor line) or --force (single version), not both.");
    process.exit(1);
  }

  if (!FORCE && !TEST_TO_ARG && version !== "Unreleased") {
    const previousForCheck =
      PREVIOUS_VERSION_ARG !== undefined ? PREVIOUS_VERSION_ARG || null : null;
    const bump = shouldSendProductUpdateEmail(version, previousForCheck, {
      lineClose: LINE_CLOSE,
    });
    if (!bump.send) {
      console.log(`Skipping release email: ${bump.reason}`);
      if (DRY_RUN) console.log("--dry-run: would not send under current policy.");
      return;
    }
    console.log(`Release email bump check: ${bump.reason}`);
  }

  let section: string | null;
  let displayVersion = version;
  let ledgerVersion = version;

  if (LINE_CLOSE && version !== "Unreleased") {
    const line = loadChangelogMinorLine({
      closingVersion: version,
      previousVersion: PREVIOUS_VERSION_ARG || null,
    });
    if (!line) {
      console.error(
        `Could not build minor-line CHANGELOG for ${version}` +
          (PREVIOUS_VERSION_ARG ? ` since ${PREVIOUS_VERSION_ARG}` : "")
      );
      process.exit(1);
    }
    section = line.sectionMarkdown;
    displayVersion = line.lineLabel;
    ledgerVersion = line.lineLabel;
    console.log(
      `Line-close scope: ${line.lineLabel} (${line.versions.join(", ") || "no versions"})`
    );
  } else {
    section = loadChangelogSection(version);
  }

  if (!section) {
    console.error(`Could not find CHANGELOG section for ${version}`);
    process.exit(1);
  }

  if (!isTransactionalEmailConfigured()) {
    console.error("RESEND_API_KEY and TELEMETRY_EMAIL_FROM must be set.");
    process.exit(1);
  }

  const dashboardOrigin =
    process.env.TELEMETRY_DASHBOARD_ORIGIN?.trim() || "https://telemetry-tracker.com";

  const bodyHtml = buildReleaseEmailBodyHtml({
    version: displayVersion,
    sectionMarkdown: section,
    dashboardOrigin,
  });

  const subject =
    displayVersion === "Unreleased"
      ? "Telemetry Tracker — what's new"
      : `Telemetry Tracker ${displayVersion} is out`;

  if (TEST_TO_ARG) {
    const testSubject = `[TEST] ${subject}`;
    // When the test address is an active subscriber, stage a real one-click token so the
    // unsubscribe link can be verified end to end. Otherwise link to the generic page.
    let testUnsubscribeUrl = `${dashboardOrigin}/unsubscribe`;
    const testSubscriber = DRY_RUN
      ? null
      : await prisma.marketingSubscriber.findFirst({
          where: { email: normalizeMarketingEmail(TEST_TO_ARG), unsubscribed_at: null },
          select: { id: true },
        });
    if (testSubscriber) {
      const rawToken = generateMarketingUnsubscribeToken();
      await stageReleaseEmailUnsubscribeToken(prisma, {
        subscriberId: testSubscriber.id,
        unsubscribeTokenHash: hashMarketingUnsubscribeToken(rawToken),
      });
      testUnsubscribeUrl = buildMarketingUnsubscribeUrl(dashboardOrigin, rawToken);
      console.log("Test recipient is an active subscriber; email carries a live unsubscribe link.");
    }
    const html = appendReleaseEmailFooter(bodyHtml, testUnsubscribeUrl);

    console.log(`Test recipient: ${TEST_TO_ARG}`);
    console.log(`Subject: ${testSubject}`);
    console.log(`CHANGELOG [${displayVersion}] preview:\n${changelogPreview(section)}`);

    if (DRY_RUN) {
      console.log("--dry-run: would send one test email (not recorded in release ledger).");
      return;
    }

    const result = await sendTransactionalEmail({
      to: TEST_TO_ARG,
      subject: testSubject,
      html,
    });
    if (!result.sent) {
      console.error(`Failed to send test email to ${TEST_TO_ARG}:`, result.error ?? result.status);
      process.exit(1);
    }
    console.log(`Sent test release email to ${TEST_TO_ARG}.`);
    return;
  }

  const allSubscribers = await prisma.marketingSubscriber.findMany({
    where: { unsubscribed_at: null },
    select: { id: true, email: true, unsubscribe_token: true },
    orderBy: { email: "asc" },
  });

  const skippedUndeliverable = allSubscribers.filter((sub) => !isValidMarketingEmail(sub.email));
  const subscribers = allSubscribers.filter((sub) => isValidMarketingEmail(sub.email));
  if (skippedUndeliverable.length > 0) {
    console.warn(
      `Skipping ${skippedUndeliverable.length} reserved/invalid subscriber address(es): ${skippedUndeliverable
        .map((sub) => sub.email)
        .join(", ")}`
    );
  }

  if (subscribers.length === 0) {
    const message = emptyReleaseEmailAudienceMessage(allSubscribers.length, { dryRun: DRY_RUN });
    if (DRY_RUN) {
      console.log(message);
      return;
    }
    console.error(message);
    process.exit(1);
  }

  console.log(`Prepared release email for ${subscribers.length} subscriber(s).`);
  console.log(`Subject: ${subject}`);
  console.log(`CHANGELOG [${displayVersion}] preview:\n${changelogPreview(section)}`);
  if (DRY_RUN) {
    const alreadySentIds = await loadReleaseEmailSentSubscriberIds(
      prisma,
      ledgerVersion,
      subscribers.map((sub) => sub.id)
    );
    const pending = pendingReleaseEmailRecipients(subscribers, alreadySentIds);
    console.log(
      `--dry-run: would send to ${pending.length}/${subscribers.length} subscriber(s)` +
        (alreadySentIds.size > 0
          ? ` (${alreadySentIds.size} already recorded for ${ledgerVersion}).`
          : ".")
    );
    return;
  }

  const alreadySentIds = await loadReleaseEmailSentSubscriberIds(
    prisma,
    ledgerVersion,
    subscribers.map((sub) => sub.id)
  );
  const pendingSubscribers = pendingReleaseEmailRecipients(subscribers, alreadySentIds);
  if (alreadySentIds.size > 0) {
    console.log(
      `Resuming ${ledgerVersion}: ${alreadySentIds.size} already sent, ${pendingSubscribers.length} remaining.`
    );
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
    const html = appendReleaseEmailFooter(bodyHtml, unsubscribeUrl);

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
      releaseVersion: ledgerVersion,
    });
    sentThisRun += 1;
  }

  const deliveredTotal = alreadySentIds.size + sentThisRun;
  console.log(
    `Sent ${sentThisRun} release email(s) this run (${deliveredTotal}/${subscribers.length} total for ${ledgerVersion}).`
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
