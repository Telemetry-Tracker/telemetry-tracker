import Link from "next/link";
import type { ComponentType, SVGProps } from "react";
import {
  NestJsIcon,
  NextJsIcon,
  NodeJsIcon,
  NuxtIcon,
  ReactIcon,
  ReactNativeIcon,
  VueIcon,
} from "./stack-icons";

const sdks = [
  { Icon: ReactIcon, label: "React", href: "/error-tracking/react" },
  { Icon: NextJsIcon, label: "Next.js", href: "/error-tracking/nextjs", className: "text-foreground" },
  { Icon: VueIcon, label: "Vue", href: "/docs/vue" },
  { Icon: NuxtIcon, label: "Nuxt", href: "/docs/nuxt" },
  { Icon: ReactNativeIcon, label: "React Native", href: "/error-tracking/react-native" },
  { Icon: NodeJsIcon, label: "Node.js", href: "/error-tracking/nodejs" },
  { Icon: NestJsIcon, label: "NestJS", href: "/docs/nestjs" },
] satisfies ReadonlyArray<{
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  href: string;
  className?: string;
}>;

export function SupportedSdks() {
  return (
    <section aria-label="Supported SDKs" className="border-y border-border bg-surface/30">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <p className="text-center text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Supported SDKs
        </p>
        <h2 className="mt-2 text-center text-2xl font-semibold tracking-tight text-foreground">
          Works with your stack
        </h2>
        <ul className="mt-8 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-7">
          {sdks.map(({ Icon, label, href, className }) => (
            <li key={label}>
              <Link
                href={href}
                aria-label={`${label} error tracking`}
                className="group flex flex-col items-center gap-1.5 text-center transition-colors"
              >
                <Icon className={`h-7 w-7 shrink-0 ${className ?? ""}`} />
                <span className="text-sm font-medium text-muted-foreground transition-colors group-hover:text-foreground">
                  {label}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-center text-sm text-muted-foreground">
          First-class SDKs for modern JavaScript applications.
        </p>
      </div>
    </section>
  );
}
