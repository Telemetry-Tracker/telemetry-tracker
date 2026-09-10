import Link from "next/link";

export type GuideRelatedLink = {
  href: string;
  label: string;
  description?: string;
};

export function GuideRelatedLinks({
  heading = "Related",
  links,
}: {
  heading?: string;
  links: ReadonlyArray<GuideRelatedLink>;
}) {
  if (links.length === 0) return null;

  return (
    <section className="not-prose mt-12">
      <h2 className="text-xl font-semibold tracking-tight">{heading}</h2>
      <ul className="mt-4 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2">
        {links.map((link) => (
          <li key={link.href} className="bg-background">
            <Link
              href={link.href}
              className="block h-full p-4 transition-colors hover:bg-surface/60"
            >
              <span className="text-sm font-medium text-foreground">{link.label}</span>
              {link.description ? (
                <span className="mt-1 block text-sm text-muted-foreground">{link.description}</span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
