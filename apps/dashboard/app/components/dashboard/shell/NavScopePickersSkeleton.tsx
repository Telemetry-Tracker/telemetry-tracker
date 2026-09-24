export function NavScopePickersSkeleton({
  variant = "header",
}: {
  variant?: "sidebar" | "header";
}) {
  if (variant === "sidebar") {
    return (
      <div className="flex w-full min-w-0 flex-col gap-1.5" aria-hidden>
        <div className="h-8 w-full animate-pulse rounded-md border border-border bg-surface motion-reduce:animate-none" />
        <div className="h-8 w-full animate-pulse rounded-md border border-border bg-surface motion-reduce:animate-none" />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5" aria-hidden>
      <div className="h-8 w-28 shrink-0 animate-pulse rounded-md border border-border bg-surface motion-reduce:animate-none sm:w-36" />
      <div className="h-8 w-24 shrink-0 animate-pulse rounded-md border border-border bg-surface motion-reduce:animate-none" />
    </div>
  );
}
