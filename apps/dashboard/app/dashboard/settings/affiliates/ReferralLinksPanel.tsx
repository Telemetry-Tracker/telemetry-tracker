"use client";

import { toast } from "sonner";
import { SettingsBtn } from "@/app/components/dashboard/settings/settings-ui";
import { AFFILIATE_DEEP_LINK_DESTINATIONS, affiliateReferralUrl } from "@/lib/affiliate-program";

export function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <SettingsBtn
      type="button"
      size="sm"
      variant="outline"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          toast.success("Copied to clipboard");
        } catch {
          toast.error("Could not copy. Select the link and copy it manually.");
        }
      }}
    >
      Copy
    </SettingsBtn>
  );
}

/** Main referral URL + copyable deep links to verified `?ref=` destinations. */
export function ReferralLinksPanel({ code }: { code: string }) {
  const main = affiliateReferralUrl(code);
  const deepLinks = AFFILIATE_DEEP_LINK_DESTINATIONS.filter((d) => d.path !== "/");
  return (
    <div className="space-y-3" data-testid="referral-links">
      <div className="rounded-lg border border-border bg-surface/40 p-3">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Referral URL</div>
        <div className="mt-1.5 flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all font-mono text-[13px] text-foreground">{main}</code>
          <CopyButton value={main} label={`Copy referral URL ${main}`} />
        </div>
      </div>
      <details className="rounded-lg border border-border">
        <summary className="cursor-pointer px-3 py-2 text-[13px] text-muted-foreground hover:text-foreground">
          Deep links ({deepLinks.length})
        </summary>
        <ul className="divide-y divide-border border-t border-border">
          {deepLinks.map((d) => {
            const url = affiliateReferralUrl(code, d.path);
            return (
              <li key={d.path} className="flex items-center gap-3 px-3 py-2">
                <span className="w-40 shrink-0 text-[12px] text-muted-foreground">{d.label}</span>
                <code className="min-w-0 flex-1 break-all font-mono text-[12px]">{url}</code>
                <CopyButton value={url} label={`Copy ${d.label} link`} />
              </li>
            );
          })}
        </ul>
      </details>
    </div>
  );
}
