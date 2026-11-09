import Link from "next/link";
import { KeyRound } from "lucide-react";
import {
  connectAppHref,
  type OverviewSetupBannerMode,
} from "@/lib/connect-app-setup";
import { isUnselectedTimeRange } from "@/lib/time-range";

export type { OverviewSetupBannerMode };

export function OverviewIngestSetupBanner({
  rangeKey,
  rangeLabel,
  eventsCount,
  errorsCount,
  mode,
  appName,
}: {
  rangeKey: string;
  rangeLabel: string;
  eventsCount: number;
  errorsCount: number;
  mode: OverviewSetupBannerMode;
  appName?: string | null;
}) {
  if (eventsCount > 0 || errorsCount > 0 || mode === "none") return null;

  if (mode === "finish_setup" && appName) {
    return (
      <Banner
        title={`Finish setting up ${appName}`}
        body="This application is registered but has not received its first event yet. Continue the existing setup — we won’t create a duplicate."
        primary={{ href: connectAppHref(appName), label: "Continue setup →" }}
        secondary={{ href: "/dashboard/settings/keys", label: "API keys" }}
      />
    );
  }

  if (mode === "quiet_window") {
    const windowLabel = isUnselectedTimeRange(rangeKey)
      ? "recently"
      : rangeLabel.toLowerCase();
    return (
      <Banner
        title={
          appName
            ? `No telemetry for ${appName} (${windowLabel})`
            : `No telemetry in selected window (${windowLabel})`
        }
        body={
          appName
            ? "This app has connected before. If traffic stopped unexpectedly, revisit setup or troubleshoot the SDK configuration."
            : "Nothing matched this time range. Try another range, or revisit setup if you expected new data."
        }
        primary={
          appName
            ? { href: connectAppHref(appName, true), label: "View setup instructions →" }
            : { href: connectAppHref(), label: "Connect application →" }
        }
        secondary={
          appName
            ? { href: connectAppHref(appName, true), label: "Troubleshoot connection" }
            : { href: "/dashboard/settings/keys", label: "API keys" }
        }
      />
    );
  }

  // project_empty
  return (
    <Banner
      title={
        isUnselectedTimeRange(rangeKey)
          ? "No telemetry recorded yet"
          : `No telemetry in selected window (${rangeLabel.toLowerCase()})`
      }
      body="Connect an application to this project, create an API key, and install the SDK. You can register the app before any telemetry arrives."
      primary={{ href: connectAppHref(), label: "Connect application →" }}
      secondary={{ href: "/dashboard/settings/keys", label: "API keys" }}
    />
  );
}

function Banner({
  title,
  body,
  primary,
  secondary,
}: {
  title: string;
  body: string;
  primary: { href: string; label: string };
  secondary?: { href: string; label: string };
}) {
  return (
    <div
      className="mb-6 flex items-start gap-3 rounded-xl border border-warning/35 bg-warning/10 px-4 py-3"
      role="status"
    >
      <KeyRound className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0 text-sm">
        <p className="font-medium text-foreground">{title}</p>
        <p className="mt-1 text-muted-foreground">{body}</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <Link
            href={primary.href}
            className="inline-block font-medium text-foreground underline-offset-4 hover:underline"
          >
            {primary.label}
          </Link>
          {secondary ? (
            <Link
              href={secondary.href}
              className="inline-block font-medium text-muted-foreground underline-offset-4 hover:underline"
            >
              {secondary.label}
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
