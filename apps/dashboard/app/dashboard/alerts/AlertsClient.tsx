"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  createProjectAlertRuleAction,
  createProjectWebhookAction,
  deleteProjectAlertRuleAction,
  deleteProjectWebhookAction,
  saveProjectAlertSettingsAction,
  saveProjectPiiScrubSettingsAction,
  testProjectWebhookAction,
  updateProjectAlertRuleAction,
  updateProjectWebhookAction,
} from "@/app/dashboard/actions";
import {
  AnalyticsPanel,
  AnalyticsPanelHeader,
  AnalyticsPanelList,
} from "@/app/components/dashboard/analytics-ui";
import {
  SettingsPageBody,
  SettingsPageHeader,
} from "@/app/components/dashboard/settings/SettingsPageHeader";
import {
  Field,
  FieldGroup,
  Section,
  SettingsBtn,
  SettingsTextarea,
  SettingsToggle,
} from "@/app/components/dashboard/settings/settings-ui";
import {
  alertSettingsEqual,
  formatAdditionalEmailsInput,
  parseAdditionalEmailsInput,
  ruleLabel,
  type AlertEventRow,
  type ProjectAlertEmailRole,
  type ProjectAlertSettings,
} from "@/lib/alert-settings";
import {
  alertRuleSupportsDashboardEditor,
  createDefaultAlertRuleDraft,
  draftFromAlertRule,
  formatAlertRuleDestinations,
  formatAlertRuleSummary,
  PROJECT_EMAIL_DESTINATION_ID,
  validateAlertRuleDraft,
  type AlertRuleFormDraft,
  type AlertRuleRow,
  type DestinationOption,
} from "@/lib/alert-rules";
import {
  formatDenyKeysInput,
  normalizeProjectPiiScrubSettings,
  parseDenyKeysInput,
  piiScrubSettingsEqual,
  type ProjectPiiScrubSettings,
} from "@/lib/pii-scrub-settings";
import { formatRelativeTime } from "@/lib/format-time";
import type {
  AlertWebhookDeliveryRow,
  AlertWebhookProvider,
  ProjectWebhookRow,
} from "@/lib/project-webhooks";
import { AlertRuleEditor } from "./AlertRuleEditor";

function providerLabel(provider: AlertWebhookProvider): string {
  switch (provider) {
    case "GENERIC":
      return "Webhook";
    case "SLACK":
      return "Slack";
    case "DISCORD":
      return "Discord";
    case "MICROSOFT_TEAMS":
      return "Microsoft Teams";
    case "TELEGRAM":
      return "Telegram";
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}

/** Channels exposed in Alerts → Delivery for this milestone PR. */
const DELIVERY_PROVIDER_OPTIONS: {
  value: AlertWebhookProvider;
  label: string;
  urlPlaceholder: string;
}[] = [
  {
    value: "GENERIC",
    label: "HTTPS webhook",
    urlPlaceholder: "https://hooks.example.com/alerts",
  },
  {
    value: "SLACK",
    label: "Slack",
    urlPlaceholder: "https://hooks.slack.com/services/T…/B…/…",
  },
  {
    value: "DISCORD",
    label: "Discord",
    urlPlaceholder: "https://discord.com/api/webhooks/…/…",
  },
  {
    value: "MICROSOFT_TEAMS",
    label: "Microsoft Teams",
    urlPlaceholder: "https://….webhook.office.com/webhookb2/…",
  },
  {
    value: "TELEGRAM",
    label: "Telegram",
    urlPlaceholder: "https://api.telegram.org/bot<token>/sendMessage",
  },
];

function deliveryStatusLabel(status: AlertWebhookDeliveryRow["status"]): string {
  switch (status) {
    case "PENDING":
      return "Pending";
    case "PROCESSING":
      return "Sending";
    case "SUCCESS":
      return "Success";
    case "FAILED":
      return "Failed";
    case "DEAD":
      return "Dead";
    default:
      return status;
  }
}

export function AlertsClient({
  initialSettings,
  initialEvents,
  initialRules,
  initialWebhooks,
  initialDeliveries,
  initialPiiSettings,
  piiSettingsLoadError = null,
  canEdit,
  emailChannelEnabled = true,
}: {
  initialSettings: ProjectAlertSettings;
  initialEvents: AlertEventRow[];
  initialRules: AlertRuleRow[];
  initialWebhooks: ProjectWebhookRow[];
  initialDeliveries: AlertWebhookDeliveryRow[];
  initialPiiSettings: ProjectPiiScrubSettings;
  /** When set, PII section is read-only — do not save (avoids wiping deny-keys). */
  piiSettingsLoadError?: string | null;
  canEdit: boolean;
  /** Master email channel. Off means listed alert recipients never get mail. */
  emailChannelEnabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [piiPending, startPiiTransition] = useTransition();
  const [webhookPending, startWebhookTransition] = useTransition();
  const [rulePending, startRuleTransition] = useTransition();
  const [settings, setSettings] = useState(initialSettings);
  const [rules, setRules] = useState(initialRules);
  const [webhooks, setWebhooks] = useState(initialWebhooks);
  const [webhookProvider, setWebhookProvider] =
    useState<AlertWebhookProvider>("GENERIC");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookLabel, setWebhookLabel] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [lastSigningSecret, setLastSigningSecret] = useState<{
    webhookId: string;
    secret: string;
  } | null>(null);
  const [ruleDraft, setRuleDraft] = useState<AlertRuleFormDraft>(() =>
    createDefaultAlertRuleDraft()
  );
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [denyKeysText, setDenyKeysText] = useState(() =>
    formatDenyKeysInput(initialPiiSettings.denyKeys)
  );
  const [scrubSessionUserEmail, setScrubSessionUserEmail] = useState(
    () => initialPiiSettings.scrubSessionUserEmail
  );
  const [savedPii, setSavedPii] = useState(() =>
    normalizeProjectPiiScrubSettings(initialPiiSettings)
  );
  const piiEditable = canEdit && !piiSettingsLoadError;

  useEffect(() => {
    setWebhooks(initialWebhooks);
    setLastSigningSecret((prev) =>
      prev && initialWebhooks.some((w) => w.id === prev.webhookId) ? prev : null
    );
  }, [initialWebhooks]);

  useEffect(() => {
    setRules(initialRules);
  }, [initialRules]);

  const destinationOptions = useMemo((): DestinationOption[] => {
    return [
      {
        id: PROJECT_EMAIL_DESTINATION_ID,
        label: "Project alert email",
        kind: "Email",
        enabled: true,
      },
      ...webhooks.map((wh) => ({
        id: wh.id,
        label:
          wh.label?.trim() ||
          `${providerLabel(wh.provider)} · ${wh.urlMasked}`,
        kind: providerLabel(wh.provider),
        enabled: wh.enabled,
      })),
    ];
  }, [webhooks]);

  // After router.refresh(), props can recover from a failed load while useState
  // still holds fallback defaults — resync so a later save cannot wipe real keys.
  // Key on values (not object identity) so alert-settings refresh does not discard
  // unsaved PII edits when the server returns a new props object with the same data.
  const piiPropsSyncKey = piiSettingsLoadError
    ? `error:${piiSettingsLoadError}`
    : `ok:${initialPiiSettings.scrubSessionUserEmail}:${initialPiiSettings.denyKeys.join("\0")}`;
  const lastSyncedPiiKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (piiSettingsLoadError) return;
    if (lastSyncedPiiKeyRef.current === piiPropsSyncKey) return;
    lastSyncedPiiKeyRef.current = piiPropsSyncKey;
    const normalized = normalizeProjectPiiScrubSettings(initialPiiSettings);
    setSavedPii(normalized);
    setDenyKeysText(formatDenyKeysInput(normalized.denyKeys));
    setScrubSessionUserEmail(normalized.scrubSessionUserEmail);
  }, [piiPropsSyncKey, piiSettingsLoadError, initialPiiSettings]);

  const dirty = useMemo(
    () => !alertSettingsEqual(settings, initialSettings),
    [settings, initialSettings]
  );
  const piiDirty = useMemo(() => {
    if (piiSettingsLoadError) return false;
    const next: ProjectPiiScrubSettings = {
      denyKeys: parseDenyKeysInput(denyKeysText),
      scrubSessionUserEmail,
    };
    return !piiScrubSettingsEqual(next, savedPii);
  }, [denyKeysText, scrubSessionUserEmail, savedPii, piiSettingsLoadError]);

  function save() {
    startTransition(async () => {
      const result = await saveProjectAlertSettingsAction(settings);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Alert settings saved");
      setSettings(result.settings);
      router.refresh();
    });
  }

  function savePii() {
    if (piiSettingsLoadError) {
      toast.error(piiSettingsLoadError);
      return;
    }
    startPiiTransition(async () => {
      const nextDeny = parseDenyKeysInput(denyKeysText);
      const patch: Partial<ProjectPiiScrubSettings> = {};
      if (
        nextDeny.length !== savedPii.denyKeys.length ||
        nextDeny.some((k, i) => k !== savedPii.denyKeys[i])
      ) {
        patch.denyKeys = nextDeny;
      }
      if (scrubSessionUserEmail !== savedPii.scrubSessionUserEmail) {
        patch.scrubSessionUserEmail = scrubSessionUserEmail;
      }
      const result = await saveProjectPiiScrubSettingsAction(patch);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("PII scrub settings saved");
      const normalized = normalizeProjectPiiScrubSettings(result.settings);
      setSavedPii(normalized);
      setDenyKeysText(formatDenyKeysInput(normalized.denyKeys));
      setScrubSessionUserEmail(normalized.scrubSessionUserEmail);
      router.refresh();
    });
  }

  function reloadPiiSettings() {
    startPiiTransition(() => {
      router.refresh();
    });
  }

  function addWebhook() {
    startWebhookTransition(async () => {
      const result = await createProjectWebhookAction({
        url: webhookUrl,
        label: webhookLabel.trim() || undefined,
        provider: webhookProvider,
        withSigningSecret: webhookProvider === "GENERIC" ? true : false,
        config:
          webhookProvider === "TELEGRAM"
            ? { chatId: telegramChatId.trim() }
            : undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setWebhooks((prev) => [...prev, result.webhook]);
      setWebhookUrl("");
      setWebhookLabel("");
      setTelegramChatId("");
      setLastSigningSecret(
        result.signingSecret
          ? { webhookId: result.webhook.id, secret: result.signingSecret }
          : null
      );
      toast.success(`${providerLabel(webhookProvider)} destination added`);
      router.refresh();
    });
  }

  function toggleWebhook(id: string, enabled: boolean) {
    startWebhookTransition(async () => {
      const result = await updateProjectWebhookAction(id, { enabled });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setWebhooks((prev) => prev.map((w) => (w.id === id ? result.webhook : w)));
    });
  }

  function removeWebhook(id: string) {
    startWebhookTransition(async () => {
      const result = await deleteProjectWebhookAction(id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
      // Create mode: drop the deleted id from the draft so create cannot bind it.
      // Edit mode: leave destinationIds alone — silent pruning would PATCH-drop
      // bindings on Save even when the user only changed name/thresholds/cooldown.
      // Orphans remain visible in AlertRuleEditor for an explicit uncheck.
      if (!editingRuleId) {
        setRuleDraft((prev) => ({
          ...prev,
          destinationIds: prev.destinationIds.filter((wid) => wid !== id),
        }));
      }
      setLastSigningSecret((prev) => (prev?.webhookId === id ? null : prev));
      toast.success("Webhook removed");
      router.refresh();
    });
  }

  function resetRuleEditor() {
    setEditingRuleId(null);
    setRuleDraft(createDefaultAlertRuleDraft());
  }

  function beginEditRule(rule: AlertRuleRow) {
    setEditingRuleId(rule.id);
    // Keep stored destinationIds as-is — do not drop bindings just because the
    // Delivery list failed to load or is momentarily incomplete.
    setRuleDraft(draftFromAlertRule(rule));
  }

  function submitAlertRule() {
    const validated = validateAlertRuleDraft(ruleDraft);
    if (!validated.ok) {
      toast.error(validated.error);
      return;
    }
    const { payload } = validated;
    startRuleTransition(async () => {
      if (editingRuleId) {
        const result = await updateProjectAlertRuleAction(editingRuleId, {
          name: payload.name,
          conditions: payload.conditions,
          destinationIds: payload.destinationIds,
          cooldownMinutes: payload.cooldownMinutes,
        });
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        setRules((prev) =>
          prev.map((r) => (r.id === editingRuleId ? result.rule : r))
        );
        resetRuleEditor();
        toast.success("Alert rule updated");
        router.refresh();
        return;
      }
      const result = await createProjectAlertRuleAction({
        name: payload.name,
        conditions: payload.conditions,
        destinationIds: payload.destinationIds,
        cooldownMinutes: payload.cooldownMinutes,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setRules((prev) => [...prev, result.rule]);
      resetRuleEditor();
      toast.success("Alert rule created");
      router.refresh();
    });
  }

  function toggleAlertRule(id: string, enabled: boolean) {
    startRuleTransition(async () => {
      const result = await updateProjectAlertRuleAction(id, { enabled });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setRules((prev) => prev.map((r) => (r.id === id ? result.rule : r)));
    });
  }

  function removeAlertRule(id: string) {
    startRuleTransition(async () => {
      const result = await deleteProjectAlertRuleAction(id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setRules((prev) => prev.filter((r) => r.id !== id));
      if (editingRuleId === id) {
        resetRuleEditor();
      }
      toast.success("Alert rule removed");
      router.refresh();
    });
  }

  function testWebhook(id: string) {
    startWebhookTransition(async () => {
      const result = await testProjectWebhookAction(id);
      if (!result.ok) {
        toast.error(result.error);
        router.refresh();
        return;
      }
      toast.success(`Test delivered (HTTP ${result.httpStatus})`);
      router.refresh();
    });
  }

  return (
    <>
      <SettingsPageHeader
        title="Alerts"
        description="Configurable rules and built-in thresholds for the active project. Fired alerts appear in the notification bell and fan out to the destinations you bind."
        actions={
          canEdit ? (
            <SettingsBtn variant="primary" disabled={!dirty || pending} onClick={save}>
              {pending ? "Saving…" : "Save changes"}
            </SettingsBtn>
          ) : null
        }
      />
      <SettingsPageBody>
        {!canEdit ? (
          <p className="mb-4 text-[13px] text-muted-foreground">
            You need editor or owner access to change alert rules.
          </p>
        ) : null}

        <Section
          title="Custom rules"
          description="Rules decide when to fire (AND of conditions) and which opaque destination ids to notify. Delivery (email, Slack, Discord, …) is owned by Notifications — not by the rule."
        >
          {rules.length > 0 ? (
            <ul className="mb-4 divide-y divide-border rounded-md border border-border">
              {rules.map((rule) => {
                const isEditing = editingRuleId === rule.id;
                return (
                  <li
                    key={rule.id}
                    className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-foreground">
                        {rule.name}
                        {isEditing ? (
                          <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                            editing
                          </span>
                        ) : null}
                      </p>
                      <p className="text-[12px] text-muted-foreground">
                        {formatAlertRuleSummary(rule)} · cooldown{" "}
                        {rule.cooldownMinutes}m ·{" "}
                        {formatAlertRuleDestinations(
                          rule.destinationIds,
                          destinationOptions
                        )}
                      </p>
                      {rule.conditions.length === 0 ? (
                        <p className="mt-1 text-[12px] text-destructive">
                          Stored conditions are invalid or unsupported — edit to
                          fix, or disable/remove.
                        </p>
                      ) : !alertRuleSupportsDashboardEditor(rule) ? (
                        <p className="mt-1 text-[12px] text-muted-foreground">
                          Includes scheduled/advanced conditions — toggle or
                          remove here; edit via API until the dashboard editor
                          supports them.
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
                      <div
                        className={
                          canEdit ? undefined : "pointer-events-none opacity-50"
                        }
                      >
                        <SettingsToggle
                          on={rule.enabled}
                          onChange={(enabled) =>
                            toggleAlertRule(rule.id, enabled)
                          }
                        />
                      </div>
                      {canEdit ? (
                        <>
                          {alertRuleSupportsDashboardEditor(rule) ? (
                            <SettingsBtn
                              variant="outline"
                              disabled={rulePending}
                              onClick={() => beginEditRule(rule)}
                            >
                              Edit
                            </SettingsBtn>
                          ) : null}
                          <SettingsBtn
                            variant="ghost"
                            disabled={rulePending}
                            onClick={() => removeAlertRule(rule.id)}
                          >
                            Remove
                          </SettingsBtn>
                        </>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="mb-4 rounded-md border border-dashed border-border bg-surface/20 px-4 py-6 text-center">
              <p className="text-[13px] font-medium text-foreground">
                No custom rules yet
              </p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Create a rule below to fire when error counts cross a threshold.
                Built-in spike and quota alerts still work without a custom
                rule.
              </p>
            </div>
          )}

          {canEdit ? (
            <div className="rounded-md border border-border bg-surface/10 p-4">
              <p className="mb-3 text-[13px] font-medium text-foreground">
                {editingRuleId ? "Edit rule" : "Create rule"}
              </p>
              <AlertRuleEditor
                mode={editingRuleId ? "edit" : "create"}
                draft={ruleDraft}
                onChange={setRuleDraft}
                destinations={destinationOptions}
                pending={rulePending}
                onSubmit={submitAlertRule}
                onCancel={editingRuleId ? resetRuleEditor : undefined}
                submitLabel={editingRuleId ? "Save changes" : "Create rule"}
              />
            </div>
          ) : null}
        </Section>

        <Section
          title="Error spike"
          description="Built-in system rule: fire when error occurrences in a rolling window exceed your threshold (all environments; fans out to all email recipients and delivery channels). Stored as a system-managed AlertRule — edit here, not under Custom rules."
        >
          <FieldGroup>
            <Field label="Enable error spike alerts" htmlFor="error-spike-toggle">
              <div className={canEdit ? undefined : "pointer-events-none opacity-50"}>
                <SettingsToggle
                  id="error-spike-toggle"
                  on={settings.errorSpike.enabled}
                  onChange={() =>
                    setSettings((s) => ({
                      ...s,
                      errorSpike: { ...s.errorSpike, enabled: !s.errorSpike.enabled },
                    }))
                  }
                />
              </div>
            </Field>
            <Field label="Threshold (errors per window)" htmlFor="error-threshold">
              <input
                id="error-threshold"
                type="number"
                min={1}
                max={10000}
                disabled={!canEdit || !settings.errorSpike.enabled}
                value={settings.errorSpike.threshold}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    errorSpike: {
                      ...s.errorSpike,
                      threshold: Number(e.target.value) || 1,
                    },
                  }))
                }
                className="w-32 rounded-md border border-border bg-background px-2 py-1.5 text-[13px] disabled:opacity-50"
              />
            </Field>
            <Field label="Window (minutes)" htmlFor="error-window">
              <input
                id="error-window"
                type="number"
                min={5}
                max={1440}
                disabled={!canEdit || !settings.errorSpike.enabled}
                value={settings.errorSpike.windowMinutes}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    errorSpike: {
                      ...s.errorSpike,
                      windowMinutes: Number(e.target.value) || 15,
                    },
                  }))
                }
                className="w-32 rounded-md border border-border bg-background px-2 py-1.5 text-[13px] disabled:opacity-50"
              />
            </Field>
          </FieldGroup>
        </Section>

        <Section
          title="Ingest quota"
          description="Built-in system rules: warn before monthly ingest limits are reached; exceeded alerts always fire when usage is at or above the limit. Stored as system-managed AlertRules — edit warnings here, not under Custom rules."
        >
          <FieldGroup>
            <Field label="Enable quota warnings" htmlFor="quota-toggle">
              <div className={canEdit ? undefined : "pointer-events-none opacity-50"}>
                <SettingsToggle
                  id="quota-toggle"
                  on={settings.quota.enabled}
                  onChange={() =>
                    setSettings((s) => ({
                      ...s,
                      quota: { ...s.quota, enabled: !s.quota.enabled },
                    }))
                  }
                />
              </div>
            </Field>
            <Field label="Warning threshold (%)" htmlFor="quota-threshold">
              <input
                id="quota-threshold"
                type="number"
                min={50}
                max={99}
                disabled={!canEdit || !settings.quota.enabled}
                value={settings.quota.nearPercent}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    quota: {
                      ...s.quota,
                      nearPercent: Number(e.target.value) || 90,
                    },
                  }))
                }
                className="w-32 rounded-md border border-border bg-background px-2 py-1.5 text-[13px] disabled:opacity-50"
              />
            </Field>
          </FieldGroup>
        </Section>

        <Section
          title="Email recipients"
          description="Who receives this project's alert emails (spike/quota) and new-error emails. Alert mail uses the Alerts email route; new-error mail uses the Issues route — both still need the global email channel on."
        >
          {emailChannelEnabled ? null : (
            <p
              role="status"
              className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[13px] text-foreground"
            >
              The Email channel is off for your account, so alert rules will not send email
              even when recipients are listed here.{" "}
              <Link href="/dashboard/settings/notifications" className="text-link hover:underline">
                Turn on the Email channel
              </Link>
              .
            </p>
          )}
          <FieldGroup>
            <Field label="Send alert emails for this project">
              <div className={canEdit ? undefined : "pointer-events-none opacity-50"}>
                <SettingsToggle
                  on={settings.email.enabled}
                  onChange={(enabled) =>
                    setSettings((s) => ({
                      ...s,
                      email: { ...s.email, enabled },
                    }))
                  }
                />
              </div>
            </Field>
            <Field label="Include org roles">
              <div
                className={`flex flex-wrap gap-3 ${canEdit && settings.email.enabled ? "" : "pointer-events-none opacity-50"}`}
              >
                {(
                  [
                    { id: "OWNER" as const, label: "Owners" },
                    { id: "EDITOR" as const, label: "Editors" },
                    { id: "VIEWER" as const, label: "Viewers" },
                  ] satisfies { id: ProjectAlertEmailRole; label: string }[]
                ).map((role) => {
                  const on = settings.email.roles.includes(role.id);
                  return (
                    <label
                      key={role.id}
                      className="flex items-center gap-2 text-[13px]"
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={!canEdit || !settings.email.enabled}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setSettings((s) => {
                            const next = new Set(s.email.roles);
                            if (checked) next.add(role.id);
                            else next.delete(role.id);
                            const roles = [...next] as ProjectAlertEmailRole[];
                            if (roles.length === 0) return s;
                            return {
                              ...s,
                              email: { ...s.email, roles },
                            };
                          });
                        }}
                      />
                      {role.label}
                    </label>
                  );
                })}
              </div>
            </Field>
            <Field label="Additional emails (optional)">
              <SettingsTextarea
                value={formatAdditionalEmailsInput(settings.email.additionalEmails)}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    email: {
                      ...s.email,
                      additionalEmails: parseAdditionalEmailsInput(e.target.value),
                    },
                  }))
                }
                disabled={!canEdit || !settings.email.enabled}
                placeholder={"ops@example.com\noncall@example.com"}
                rows={3}
                className="max-w-xl font-mono text-[12px]"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Up to 10 addresses, one per line. Registered accounts respect their
                notification preferences (Alerts for alert mail, Issues for new
                errors); unknown addresses receive project alert/new-error mail
                directly.
              </p>
            </Field>
          </FieldGroup>
          <p className="mt-3 text-[13px] text-muted-foreground">
            Per-user routing lives under{" "}
            <Link href="/dashboard/settings/notifications" className="text-brand hover:underline">
              Notification settings
            </Link>
            .
          </p>
        </Section>

        <Section
          title="Delivery"
          description="HTTPS webhooks and chat destinations (Slack, Discord, Teams, Telegram) receive a message when an alert fires."
        >
          <p className="mb-3 text-[13px] text-muted-foreground">
            Generic webhook payload schema lives in{" "}
            <code className="font-mono text-[11px]">docs/ALERT-WEBHOOKS.md</code>.
            Chat channels use provider-native payloads (Incoming Webhooks or Telegram Bot API).
          </p>

          {lastSigningSecret ? (
            <div
              className="mb-3 rounded-md border border-border bg-surface/40 p-3"
              role="status"
            >
              <p className="text-[12px] font-medium text-foreground">
                Signing secret (copy now — shown once)
              </p>
              <code className="mt-1 block break-all font-mono text-[11px] text-muted-foreground">
                {lastSigningSecret.secret}
              </code>
              <button
                type="button"
                className="mt-2 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => setLastSigningSecret(null)}
              >
                Dismiss
              </button>
            </div>
          ) : null}

          {webhooks.length > 0 ? (
            <ul className="mb-4 divide-y divide-border rounded-md border border-border">
              {webhooks.map((wh) => (
                <li
                  key={wh.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">
                      {wh.label?.trim() || providerLabel(wh.provider)}
                      <span className="ml-2 rounded bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] font-normal text-muted-foreground">
                        {providerLabel(wh.provider)}
                      </span>
                    </p>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                      {wh.urlMasked}
                      {wh.hasSigningSecret ? " · signed" : ""}
                      {wh.provider === "TELEGRAM" && wh.config?.chatId
                        ? ` · chat ${wh.config.chatId}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className={canEdit ? undefined : "pointer-events-none opacity-50"}>
                      <SettingsToggle
                        on={wh.enabled}
                        onChange={(enabled) => toggleWebhook(wh.id, enabled)}
                        disabled={!canEdit || webhookPending}
                      />
                    </div>
                    {canEdit ? (
                      <>
                        <SettingsBtn
                          variant="outline"
                          disabled={webhookPending}
                          onClick={() => testWebhook(wh.id)}
                        >
                          Test
                        </SettingsBtn>
                        <SettingsBtn
                          variant="outline"
                          disabled={webhookPending}
                          onClick={() => removeWebhook(wh.id)}
                        >
                          Remove
                        </SettingsBtn>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-[13px] text-muted-foreground">
              No delivery destinations configured for this project yet.
            </p>
          )}

          {canEdit ? (
            <FieldGroup>
              <Field label="Channel">
                <select
                  value={webhookProvider}
                  onChange={(e) =>
                    setWebhookProvider(e.target.value as AlertWebhookProvider)
                  }
                  disabled={webhookPending}
                  className="w-full max-w-xs rounded-md border border-border bg-background px-2 py-1.5 text-[13px] disabled:opacity-50"
                >
                  {DELIVERY_PROVIDER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={
                  webhookProvider === "SLACK"
                    ? "Slack Incoming Webhook URL"
                    : webhookProvider === "DISCORD"
                      ? "Discord webhook URL"
                      : webhookProvider === "MICROSOFT_TEAMS"
                        ? "Teams Incoming Webhook URL"
                        : webhookProvider === "TELEGRAM"
                          ? "Telegram Bot API sendMessage URL"
                          : "HTTPS URL"
                }
              >
                <input
                  type="url"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder={
                    DELIVERY_PROVIDER_OPTIONS.find((o) => o.value === webhookProvider)
                      ?.urlPlaceholder ?? "https://…"
                  }
                  disabled={webhookPending}
                  className="w-full max-w-xl rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[12px] disabled:opacity-50"
                />
              </Field>
              {webhookProvider === "TELEGRAM" ? (
                <Field label="Chat id">
                  <input
                    type="text"
                    value={telegramChatId}
                    onChange={(e) => setTelegramChatId(e.target.value)}
                    placeholder="-100… or @channel"
                    disabled={webhookPending}
                    className="w-full max-w-xs rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[12px] disabled:opacity-50"
                  />
                </Field>
              ) : null}
              <Field label="Label (optional)">
                <input
                  type="text"
                  value={webhookLabel}
                  onChange={(e) => setWebhookLabel(e.target.value)}
                  placeholder={
                    webhookProvider === "SLACK"
                      ? "#alerts"
                      : webhookProvider === "DISCORD"
                        ? "#ops"
                        : webhookProvider === "MICROSOFT_TEAMS"
                          ? "Ops channel"
                          : webhookProvider === "TELEGRAM"
                            ? "Ops chat"
                            : "Ops channel"
                  }
                  disabled={webhookPending}
                  className="w-full max-w-xs rounded-md border border-border bg-background px-2 py-1.5 text-[13px] disabled:opacity-50"
                />
              </Field>
              <div>
                <SettingsBtn
                  variant="primary"
                  disabled={
                    webhookPending ||
                    webhookUrl.trim().length === 0 ||
                    (webhookProvider === "TELEGRAM" &&
                      telegramChatId.trim().length === 0)
                  }
                  onClick={addWebhook}
                >
                  {webhookPending
                    ? "Saving…"
                    : `Add ${providerLabel(webhookProvider).toLowerCase()}`}
                </SettingsBtn>
              </div>
            </FieldGroup>
          ) : null}

          <div className="mt-6">
            <p className="mb-2 text-[13px] font-medium text-foreground">
              Recent deliveries
            </p>
            <p className="mb-3 text-[12px] text-muted-foreground">
              Last 25 attempts (including tests). Failed retries are recorded before a final dead
              letter.
            </p>
            {initialDeliveries.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No deliveries yet.</p>
            ) : (
              <AnalyticsPanel>
                <AnalyticsPanelHeader
                  title="Deliveries"
                  description="Newest first"
                />
                <AnalyticsPanelList>
                  {initialDeliveries.map((d) => (
                    <li key={d.id} className="px-4 py-3 sm:px-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium">
                            {d.webhookLabel?.trim() || "Destination"}
                          </p>
                          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                            {d.webhookUrlMasked}
                          </p>
                          <p className="mt-1 text-[12px] text-muted-foreground">
                            {d.error
                              ? d.error
                              : d.httpStatus != null
                                ? `HTTP ${d.httpStatus}`
                                : "No HTTP status"}
                            {d.attempt > 1 ? ` · attempt ${d.attempt}` : ""}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <span className="rounded bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                            {deliveryStatusLabel(d.status)}
                          </span>
                          <p
                            className="mt-1 font-mono text-[10px] text-muted-foreground"
                            title={d.createdAt}
                          >
                            {formatRelativeTime(d.createdAt)}
                          </p>
                        </div>
                      </div>
                    </li>
                  ))}
                </AnalyticsPanelList>
              </AnalyticsPanel>
            )}
          </div>
        </Section>

        <Section
          title="PII scrubbing"
          description="Default server-side ingest already redacts common emails, tokens, secrets, and conservative phone/card patterns. This section only adds project deny-keys and an optional session-email setting — it cannot weaken the defaults."
          actions={
            piiEditable ? (
              <SettingsBtn
                variant="primary"
                disabled={!piiDirty || piiPending}
                onClick={savePii}
              >
                {piiPending ? "Saving…" : "Save PII settings"}
              </SettingsBtn>
            ) : null
          }
        >
          {piiSettingsLoadError ? (
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3" role="alert">
              <p className="text-[13px] text-destructive">
                {piiSettingsLoadError}. Saving is disabled so existing deny-keys are not
                overwritten.
              </p>
              <SettingsBtn
                variant="outline"
                disabled={piiPending}
                onClick={reloadPiiSettings}
              >
                {piiPending ? "Reloading…" : "Reload settings"}
              </SettingsBtn>
            </div>
          ) : null}
          <FieldGroup>
            <Field
              label="Deny-listed field names"
              hint="One field name per line (or comma-separated). Matched case-insensitively on property/context keys — for example nationalId or customer_ref. Additive only; field names, not regex patterns."
            >
              <SettingsTextarea
                id="pii-deny-keys"
                rows={5}
                disabled={!piiEditable}
                value={denyKeysText}
                onChange={(e) => setDenyKeysText(e.target.value)}
                placeholder={"nationalId\ncustomerRef"}
                className="font-mono text-[12px]"
                aria-label="Deny-listed field names"
                aria-describedby="pii-deny-keys-help"
              />
            </Field>
            <Field
              label="Scrub session user email"
              hint="When enabled, ingest stores Session.user_email as the placeholder [email] (not null) before persistence. Off by default. Enabling removes the real address from new sessions and may reduce user-level debugging and email search."
            >
              <div className={piiEditable ? undefined : "pointer-events-none opacity-50"}>
                <SettingsToggle
                  id="pii-scrub-session-email"
                  label="Scrub session user email"
                  on={scrubSessionUserEmail}
                  onChange={(v: boolean) => setScrubSessionUserEmail(v)}
                  disabled={!piiEditable}
                />
              </div>
            </Field>
          </FieldGroup>
          <p id="pii-deny-keys-help" className="mt-2 text-[12px] text-muted-foreground">
            Layers: (1) default server scrubbing on ingest; (2) optional SDK{" "}
            <code className="font-mono text-[11px]">piiScrub</code> before send (does not touch
            session identity); (3) this project’s deny-keys and session-email toggle. Phone/card
            heuristics miss bare digit runs by design and can false-positive on Luhn-valid IDs.
            Settings changes are recorded in the organization audit log (counts only). See{" "}
            <Link href="/docs/sdk" className="text-brand hover:underline">
              SDK docs
            </Link>
            .
          </p>
        </Section>

        <Section title="Recent alerts" description="Last 25 fired alerts for this project.">
          {initialEvents.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No alerts fired yet.</p>
          ) : (
            <AnalyticsPanel>
              <AnalyticsPanelHeader title="Recent alerts" description="Newest first" />
              <AnalyticsPanelList>
                {initialEvents.map((event) => (
                  <li key={event.id} className="px-4 py-3 sm:px-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium">{event.title}</p>
                        <p className="mt-0.5 text-[12px] text-muted-foreground">{event.body}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <span className="rounded bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {ruleLabel(event.rule)}
                        </span>
                        <p
                          className="mt-1 font-mono text-[10px] text-muted-foreground"
                          title={event.firedAt}
                        >
                          {formatRelativeTime(event.firedAt)}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </AnalyticsPanelList>
            </AnalyticsPanel>
          )}
        </Section>
      </SettingsPageBody>
    </>
  );
}
