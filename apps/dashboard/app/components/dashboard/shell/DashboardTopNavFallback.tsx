import { NavScopePickersSkeleton } from "./NavScopePickersSkeleton";

export function DashboardTopNavFallback() {
  return (
    <>
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
      <header className="sticky top-0 z-40 w-full max-w-[100vw] overflow-x-clip border-b border-border/70 bg-background/85 backdrop-blur-xl lg:pl-60">
        <div className="flex h-12 items-center gap-2 px-3 sm:px-6">
          <div className="h-8 w-8 animate-pulse rounded-md bg-muted lg:hidden" />
          <div className="min-w-0 flex-1">
            <NavScopePickersSkeleton />
          </div>
          <div className="flex shrink-0 gap-1">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-8 w-8 animate-pulse rounded-md border border-border bg-surface"
              />
            ))}
          </div>
        </div>
      </header>
    </>
  );
}
