import type { ReactNode } from "react";
import { Footer } from "@/app/components/marketing/footer";
import { Nav } from "@/app/components/marketing/nav";

type MarketingGuideLayoutProps = {
  kicker: string;
  title: string;
  lede: ReactNode;
  children: ReactNode;
};

export function MarketingGuideLayout({ kicker, title, lede, children }: MarketingGuideLayoutProps) {
  return (
    <main id="main-content" className="marketing-main-offset min-h-screen bg-background text-foreground">
      <Nav />
      <div className="mx-auto max-w-3xl px-6 pb-24 pt-16 sm:pt-20">
        <article className="min-w-0">
          <header className="mb-10 border-b border-border pb-8">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{kicker}</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
            <div className="mt-4 text-base leading-relaxed text-muted-foreground">{lede}</div>
          </header>
          <div className="prose-docs min-w-0 space-y-6 text-[15px] leading-relaxed text-foreground/85 [&_h2]:mt-10 [&_h2]:scroll-mt-36 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h3]:mt-8 [&_h3]:text-lg [&_h3]:font-semibold [&_p]:text-foreground/85 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5">
            {children}
          </div>
        </article>
      </div>
      <Footer />
    </main>
  );
}
