export function AnalyticsListLoadingSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading page…</span>
      <div className="mb-4 space-y-2">
        <div className="h-8 w-32 max-w-full animate-pulse rounded-md bg-surface/50 motion-reduce:animate-none" />
        <div className="h-4 w-80 max-w-full animate-pulse rounded-md bg-muted/50 motion-reduce:animate-none" />
      </div>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-xl border border-border bg-surface/30 motion-reduce:animate-none"
            />
          ))}
        </div>
        <div className="h-72 animate-pulse rounded-xl border border-border bg-surface/30 motion-reduce:animate-none" />
      </div>
    </div>
  );
}
