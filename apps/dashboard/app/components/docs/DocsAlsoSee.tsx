import Link from "next/link";

export function DocsAlsoSee({
  links,
}: {
  links: ReadonlyArray<{ href: string; label: string }>;
}) {
  return (
    <section className="mt-12 rounded-2xl border border-border bg-surface/40 p-5" aria-labelledby="docs-also-see">
      <h2 id="docs-also-see" className="text-xl font-semibold tracking-tight">
        Also see
      </h2>
      <ul className="mt-3 space-y-2">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="text-brand hover:underline">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
