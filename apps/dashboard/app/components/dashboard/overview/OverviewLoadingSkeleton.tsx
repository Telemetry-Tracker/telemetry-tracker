export function OverviewLoadingSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading overview…</span>
      <div className="space-y-2">
        <div className="h-8 w-36 animate-pulse rounded-md bg-surface/50 motion-reduce:animate-none" />
        <div className="h-4 w-64 max-w-full animate-pulse rounded-md bg-muted/50 motion-reduce:animate-none" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl border border-border bg-surface/30" />
        ))}
      </div>
      <div className="h-80 animate-pulse rounded-xl border border-border bg-surface/30" />
    </div>
  );
}
