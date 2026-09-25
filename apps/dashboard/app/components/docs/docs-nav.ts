export type DocsNavItem = {
  id: string;
  label: string;
  href: string;
};

export type DocsNavSection = {
  id: string;
  heading: string;
  items: DocsNavItem[];
};

export const docsNavSections: DocsNavSection[] = [
  {
    id: "start",
    heading: "Getting started",
    items: [
      { id: "hosted-cloud", label: "Hosted cloud", href: "/docs/hosted-cloud" },
      { id: "introduction", label: "Introduction", href: "/docs#introduction" },
      { id: "quickstart", label: "Quickstart", href: "/docs#quickstart" },
      { id: "concepts", label: "Core concepts", href: "/docs#concepts" },
      { id: "projects", label: "Projects & API keys", href: "/docs#projects" },
    ],
  },
  {
    id: "sdks",
    heading: "SDKs",
    items: [
      { id: "sdk", label: "SDK reference", href: "/docs/sdk" },
      { id: "nextjs", label: "Next.js", href: "/docs/nextjs" },
      { id: "node", label: "Node.js", href: "/docs/node" },
      { id: "nestjs", label: "NestJS", href: "/docs/nestjs" },
      { id: "nuxt", label: "Nuxt", href: "/docs/nuxt" },
      { id: "vue", label: "Vue", href: "/docs/vue" },
      { id: "react-native", label: "React Native", href: "/docs/react-native" },
    ],
  },
  {
    id: "platform",
    heading: "Platform",
    items: [
      { id: "errors", label: "Error tracking", href: "/docs#errors" },
      { id: "events", label: "Event tracking", href: "/docs#events" },
      { id: "sessions", label: "Sessions", href: "/docs#sessions" },
      { id: "dashboard", label: "Using the dashboard", href: "/docs/dashboard" },
      { id: "alerts", label: "Alerts", href: "/docs/alerts" },
      { id: "source-maps", label: "Source maps", href: "/docs/source-maps" },
    ],
  },
  {
    id: "reference",
    heading: "Reference",
    items: [
      { id: "ingest", label: "Ingest API", href: "/docs#ingest" },
      { id: "releases", label: "Release notes", href: "/docs/releases" },
      { id: "self-hosting", label: "Self-hosting", href: "/docs/self-hosting" },
    ],
  },
];

export const docsHomeAnchors = docsNavSections
  .flatMap((s) => s.items)
  .filter((i) => i.href.startsWith("/docs#"));
