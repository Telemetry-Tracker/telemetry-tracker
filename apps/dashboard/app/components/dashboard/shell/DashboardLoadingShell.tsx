export function DashboardLoadingShell() {
  return (
    <div className="min-h-screen bg-background text-foreground" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading dashboard…</span>
      <aside
        className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-border/70 bg-background lg:flex lg:flex-col"
        aria-hidden
      >
        <div className="px-3 pt-3 pb-2">
          <div className="h-7 w-40 animate-pulse rounded-md bg-muted" />
        </div>
        <div className="min-w-0 space-y-1.5 overflow-hidden px-3 pb-3">
          <div className="h-8 w-full animate-pulse rounded-md bg-muted" />
          <div className="h-8 w-full animate-pulse rounded-md bg-muted" />
        </div>
        <div className="space-y-1 px-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-8 w-full animate-pulse rounded-md bg-muted/70" />
          ))}
        </div>
      </aside>
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-xl lg:pl-60">
        <div className="flex h-12 items-center gap-2 px-3 sm:px-6">
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="h-8 w-28 animate-pulse rounded-md border border-border bg-surface sm:w-36" />
              <div className="h-8 w-24 animate-pulse rounded-md border border-border bg-surface" />
            </div>
          </div>
          <div className="flex gap-1.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-8 w-8 animate-pulse rounded-md border border-border bg-surface" />
            ))}
          </div>
        </div>
      </header>
      <main className="px-4 py-5 sm:px-6 lg:pl-[16.5rem] lg:pr-6">
        <div className="mb-4 space-y-2">
          <div className="h-8 w-40 max-w-full animate-pulse rounded-md bg-surface" />
          <div className="h-4 w-72 max-w-full animate-pulse rounded-md bg-muted" />
        </div>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border border-border bg-surface" />
          ))}
        </div>
        <div className="h-80 animate-pulse rounded-xl border border-border bg-surface" />
      </main>
    </div>
  );
}
