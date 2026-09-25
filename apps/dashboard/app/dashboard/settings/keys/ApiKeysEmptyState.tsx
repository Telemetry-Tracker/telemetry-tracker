"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { KeyRound } from "lucide-react";
import { createFirstDashboardApiKey } from "@/app/dashboard/actions";
import { SettingsBtn } from "@/app/components/dashboard/settings/settings-ui";

export function ApiKeysEmptyState({
  canCreate,
  onCreated,
}: {
  canCreate: boolean;
  onCreated: (key: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onQuickCreate() {
    startTransition(async () => {
      const result = await createFirstDashboardApiKey();
      if (result.ok) {
        onCreated(result.key);
        router.refresh();
      } else {
        alert(result.error);
      }
    });
  }

  return (
    <div
      className="rounded-xl border border-dashed border-border bg-muted/20 px-5 py-6"
      role="status"
    >
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="font-medium text-foreground">No API keys yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The SDK cannot send events or errors until you create a key. Keys belong to the
              project selected in the header.
            </p>
          </div>
          {canCreate ? (
            <SettingsBtn
              type="button"
              variant="primary"
              disabled={pending}
              onClick={onQuickCreate}
            >
              {pending ? "Creating…" : "Create first API key"}
            </SettingsBtn>
          ) : (
            <p className="text-sm text-muted-foreground">
              Ask an organization owner or editor to create a key for this project.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
