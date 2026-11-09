import Link from "next/link";
import { KeyRound } from "lucide-react";
import { isUnselectedTimeRange } from "@/lib/time-range";

export function OverviewIngestSetupBanner({
  rangeKey,
  rangeLabel,
  eventsCount,
  errorsCount,
}: {
  rangeKey: string;
  rangeLabel: string;
  eventsCount: number;
  errorsCount: number;
}) {
  if (eventsCount > 0 || errorsCount > 0) return null;

  const title = isUnselectedTimeRange(rangeKey)
    ? "No telemetry recorded yet"
    : `No telemetry in selected window (${rangeLabel.toLowerCase()})`;

  return (
    <div
      className="mb-6 flex items-start gap-3 rounded-xl border border-warning/35 bg-warning/10 px-4 py-3"
      role="status"
    >
      <KeyRound className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0 text-sm">
        <p className="font-medium text-foreground">{title}</p>
        <p className="mt-1 text-muted-foreground">
          Connect an application to this project, create an API key, and install the SDK. You can
          register the app before any telemetry arrives.
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <Link
            href="/dashboard/apps/connect"
            className="inline-block font-medium text-foreground underline-offset-4 hover:underline"
          >
            Connect application →
          </Link>
          <Link
            href="/dashboard/settings/keys"
            className="inline-block font-medium text-muted-foreground underline-offset-4 hover:underline"
          >
            API keys
          </Link>
        </div>
      </div>
    </div>
  );
}
