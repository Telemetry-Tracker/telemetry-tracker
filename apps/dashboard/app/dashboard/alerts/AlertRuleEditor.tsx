"use client";

import {
  Field,
  FieldGroup,
  SettingsBtn,
  SettingsToggle,
} from "@/app/components/dashboard/settings/settings-ui";
import {
  changeDraftConditionType,
  conditionTypeLabel,
  createEmptyErrorCountCondition,
  MAX_ALERT_RULE_EVENT_NAME_LENGTH,
  MAX_NO_EVENTS_WINDOW_HOURS,
  MIN_NO_EVENTS_WINDOW_HOURS,
  updateDraftCondition,
  MAX_ALERT_RULE_CONDITIONS,
  MAX_ALERT_RULE_NAME_LENGTH,
  MAX_ALERT_COOLDOWN_MINUTES,
  MAX_ERROR_COUNT_THRESHOLD,
  MAX_ERROR_COUNT_WINDOW_MINUTES,
  MIN_ALERT_COOLDOWN_MINUTES,
  MIN_ERROR_COUNT_THRESHOLD,
  MIN_ERROR_COUNT_WINDOW_MINUTES,
  PROJECT_EMAIL_DESTINATION_ID,
  type AlertRuleFormDraft,
  type DestinationOption,
  type EditableConditionType,
} from "@/lib/alert-rules";

const inputClass =
  "w-full rounded-md border border-border bg-background px-2 py-1.5 text-[13px] disabled:opacity-50";
const narrowInputClass =
  "w-28 rounded-md border border-border bg-background px-2 py-1.5 text-[13px] disabled:opacity-50";

export function AlertRuleEditor({
  mode,
  draft,
  onChange,
  destinations,
  pending,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  mode: "create" | "edit";
  draft: AlertRuleFormDraft;
  onChange: (next: AlertRuleFormDraft) => void;
  destinations: DestinationOption[];
  pending: boolean;
  onSubmit: () => void;
  onCancel?: () => void;
  submitLabel: string;
}) {
  const emailSelected = draft.destinationIds.includes(
    PROJECT_EMAIL_DESTINATION_ID
  );
  const channelOptions = destinations.filter(
    (d) => d.id !== PROJECT_EMAIL_DESTINATION_ID
  );
  const knownChannelIds = new Set(channelOptions.map((d) => d.id));
  const orphanDestinationIds = draft.destinationIds.filter(
    (id) => id !== PROJECT_EMAIL_DESTINATION_ID && !knownChannelIds.has(id)
  );
  const canAddCondition = draft.conditions.length < MAX_ALERT_RULE_CONDITIONS;

  function updateCondition(
    index: number,
    patch: Parameters<typeof updateDraftCondition>[2]
  ) {
    onChange(updateDraftCondition(draft, index, patch));
  }

  function changeType(index: number, type: EditableConditionType) {
    onChange(changeDraftConditionType(draft, index, type));
  }

  function removeCondition(key: string) {
    if (draft.conditions.length <= 1) return;
    onChange({
      ...draft,
      conditions: draft.conditions.filter((c) => c.key !== key),
    });
  }

  function addCondition() {
    if (!canAddCondition) return;
    onChange({
      ...draft,
      conditions: [...draft.conditions, createEmptyErrorCountCondition()],
    });
  }

  function toggleDestination(id: string, checked: boolean) {
    onChange({
      ...draft,
      destinationIds: checked
        ? [...new Set([...draft.destinationIds, id])]
        : draft.destinationIds.filter((d) => d !== id),
    });
  }

  return (
    <FieldGroup>
      <Field label="Name">
        <input
          type="text"
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          placeholder="Production error spike"
          maxLength={MAX_ALERT_RULE_NAME_LENGTH}
          disabled={pending}
          className={`${inputClass} max-w-md`}
          aria-label="Rule name"
        />
      </Field>

      <Field
        label="Conditions (AND)"
        hint={`Every condition must match. Up to ${MAX_ALERT_RULE_CONDITIONS} conditions. "No events (heartbeat)" alerts when an expected event — e.g. trackEvent("signup_verified") — has not arrived for a number of hours.`}
      >
        <div className="flex flex-col gap-3">
          {draft.conditions.length === 0 ? (
            <p className="text-[12px] text-destructive" role="status">
              {mode === "edit"
                ? "Stored conditions are invalid or unsupported. Add at least one condition before saving — defaults are not applied automatically."
                : "Add at least one condition."}
            </p>
          ) : null}
          {draft.conditions.map((condition, index) => (
            <div key={condition.key}>
              {index > 0 ? (
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  And
                </p>
              ) : null}
              <div className="rounded-md border border-border bg-surface/30 p-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <label className="flex min-w-0 flex-1 flex-col gap-1 text-[12px] text-muted-foreground">
                    Type
                    <select
                      value={condition.type}
                      disabled={pending}
                      onChange={(e) =>
                        changeType(index, e.target.value as EditableConditionType)
                      }
                      className={`${inputClass} max-w-xs`}
                      aria-label={`Condition ${index + 1} type`}
                    >
                      <option value="ERROR_COUNT">
                        {conditionTypeLabel("ERROR_COUNT")}
                      </option>
                      <option value="NO_EVENTS">
                        {conditionTypeLabel("NO_EVENTS")}
                      </option>
                    </select>
                  </label>
                  {draft.conditions.length > 1 ? (
                    <SettingsBtn
                      variant="ghost"
                      disabled={pending}
                      onClick={() => removeCondition(condition.key)}
                    >
                      Remove
                    </SettingsBtn>
                  ) : null}
                </div>
                {condition.type === "NO_EVENTS" ? (
                  <>
                    <fieldset className="mb-3 flex flex-col gap-1.5 text-[12px] text-muted-foreground">
                      <legend className="mb-1">Watch</legend>
                      <div className="flex flex-wrap gap-4">
                        <label className="flex items-center gap-1.5 text-[13px] text-foreground">
                          <input
                            type="radio"
                            name={`condition-${condition.key}-event-scope`}
                            value="all"
                            checked={condition.eventScope === "all"}
                            disabled={pending}
                            onChange={() =>
                              updateCondition(index, { eventScope: "all" })
                            }
                            aria-label={`Condition ${index + 1} all events`}
                          />
                          All events in the project
                        </label>
                        <label className="flex items-center gap-1.5 text-[13px] text-foreground">
                          <input
                            type="radio"
                            name={`condition-${condition.key}-event-scope`}
                            value="specific"
                            checked={condition.eventScope === "specific"}
                            disabled={pending}
                            onChange={() =>
                              updateCondition(index, { eventScope: "specific" })
                            }
                            aria-label={`Condition ${index + 1} specific event`}
                          />
                          A specific event
                        </label>
                      </div>
                    </fieldset>
                    <div className="flex flex-wrap gap-3">
                      {condition.eventScope === "specific" ? (
                      <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-[12px] text-muted-foreground">
                        Event name
                        <input
                          type="text"
                          value={condition.eventName}
                          disabled={pending}
                          onChange={(e) =>
                            updateCondition(index, { eventName: e.target.value })
                          }
                          placeholder="signup_verified"
                          maxLength={MAX_ALERT_RULE_EVENT_NAME_LENGTH}
                          className={`${inputClass} font-mono`}
                          aria-label={`Condition ${index + 1} event name`}
                          aria-invalid={!condition.eventName.trim()}
                          required
                        />
                        {!condition.eventName.trim() ? (
                          <span className="text-destructive" role="status">
                            Enter the event name, or choose &quot;All events&quot;.
                          </span>
                        ) : null}
                      </label>
                      ) : null}
                      <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
                        No event for (hours)
                        <input
                          type="number"
                          min={MIN_NO_EVENTS_WINDOW_HOURS}
                          max={MAX_NO_EVENTS_WINDOW_HOURS}
                          value={condition.windowHours}
                          disabled={pending}
                          onChange={(e) =>
                            updateCondition(index, {
                              windowHours: Number(e.target.value) || MIN_NO_EVENTS_WINDOW_HOURS,
                            })
                          }
                          className={narrowInputClass}
                          aria-label={`Condition ${index + 1} window hours`}
                        />
                      </label>
                      <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-[12px] text-muted-foreground">
                        Environment (optional)
                        <input
                          type="text"
                          value={condition.environment}
                          disabled={pending}
                          onChange={(e) =>
                            updateCondition(index, {
                              environment: e.target.value,
                            })
                          }
                          placeholder="production"
                          maxLength={64}
                          className={inputClass}
                          aria-label={`Condition ${index + 1} environment`}
                        />
                      </label>
                    </div>
                    <p className="mt-2 text-[12px] text-muted-foreground">
                      {condition.eventScope === "specific" ? (
                        <>
                          Exact name as sent with <code>trackEvent()</code>.{" "}
                        </>
                      ) : (
                        <>Alerts when no event of any name arrives. </>
                      )}
                      Pick a window comfortably longer than the usual
                      gap between these events (max {MAX_NO_EVENTS_WINDOW_HOURS}h) —
                      quiet apps can go hours without a signup. While the event stays
                      missing the alert repeats every cooldown; there is no recovery
                      notification.
                    </p>
                  </>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
                      Threshold
                      <input
                        type="number"
                        min={MIN_ERROR_COUNT_THRESHOLD}
                        max={MAX_ERROR_COUNT_THRESHOLD}
                        value={condition.threshold}
                        disabled={pending}
                        onChange={(e) =>
                          updateCondition(index, {
                            threshold: Number(e.target.value) || 1,
                          })
                        }
                        className={narrowInputClass}
                        aria-label={`Condition ${index + 1} threshold`}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
                      Window (minutes)
                      <input
                        type="number"
                        min={MIN_ERROR_COUNT_WINDOW_MINUTES}
                        max={MAX_ERROR_COUNT_WINDOW_MINUTES}
                        value={condition.windowMinutes}
                        disabled={pending}
                        onChange={(e) =>
                          updateCondition(index, {
                            windowMinutes: Number(e.target.value) || 15,
                          })
                        }
                        className={narrowInputClass}
                        aria-label={`Condition ${index + 1} window minutes`}
                      />
                    </label>
                    <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-[12px] text-muted-foreground">
                      Environment (optional)
                      <input
                        type="text"
                        value={condition.environment}
                        disabled={pending}
                        onChange={(e) =>
                          updateCondition(index, {
                            environment: e.target.value,
                          })
                        }
                        placeholder="production"
                        maxLength={64}
                        className={inputClass}
                        aria-label={`Condition ${index + 1} environment`}
                      />
                    </label>
                  </div>
                )}
              </div>
            </div>
          ))}
          <div>
            <SettingsBtn
              variant="outline"
              disabled={pending || !canAddCondition}
              onClick={addCondition}
            >
              {canAddCondition
                ? "Add condition"
                : `Limit ${MAX_ALERT_RULE_CONDITIONS} conditions`}
            </SettingsBtn>
          </div>
        </div>
      </Field>

      <Field
        label="Cooldown (minutes)"
        hint="Minimum time between alerts from this rule. Heartbeat rules default to their window."
      >
        <input
          type="number"
          min={MIN_ALERT_COOLDOWN_MINUTES}
          max={MAX_ALERT_COOLDOWN_MINUTES}
          value={draft.cooldownMinutes}
          disabled={pending}
          onChange={(e) =>
            onChange({
              ...draft,
              cooldownMinutes: Number(e.target.value) || MIN_ALERT_COOLDOWN_MINUTES,
            })
          }
          className={narrowInputClass}
          aria-label="Cooldown minutes"
        />
      </Field>

      <Field
        label="Destinations"
        hint="Opaque destination ids. Notifications resolves email and Delivery channels — rules do not embed Slack/Discord send logic."
      >
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-[13px] text-foreground">
            <SettingsToggle
              aria-label="Project alert email"
              on={emailSelected}
              onChange={(on) =>
                toggleDestination(PROJECT_EMAIL_DESTINATION_ID, on)
              }
              disabled={pending}
            />
            <span>
              Project alert email
              <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">
                {PROJECT_EMAIL_DESTINATION_ID}
              </span>
            </span>
          </label>

          {channelOptions.length === 0 && orphanDestinationIds.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              No Delivery channels yet. Add Slack, Discord, Teams, Telegram, or a
              webhook under <span className="font-medium">Delivery</span> below,
              then bind their ids here.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {channelOptions.map((opt) => {
                const checked = draft.destinationIds.includes(opt.id);
                return (
                  <li key={opt.id}>
                    <label className="flex items-start gap-2 text-[13px] text-foreground">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={checked}
                        disabled={pending}
                        onChange={(e) =>
                          toggleDestination(opt.id, e.target.checked)
                        }
                      />
                      <span className="min-w-0">
                        <span className="block truncate">{opt.label}</span>
                        <span className="block font-mono text-[11px] text-muted-foreground">
                          {opt.kind}
                          {!opt.enabled ? " · disabled" : ""} · {opt.id}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
              {orphanDestinationIds.map((id) => (
                <li key={id}>
                  <label className="flex items-start gap-2 text-[13px] text-foreground">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked
                      disabled={pending}
                      onChange={(e) => toggleDestination(id, e.target.checked)}
                    />
                    <span className="min-w-0">
                      <span className="block truncate">
                        Bound destination (not in current Delivery list)
                      </span>
                      <span className="block font-mono text-[11px] text-muted-foreground">
                        keep binding · {id}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {draft.destinationIds.length === 0 ? (
            <p className="text-[12px] text-destructive" role="status">
              Select at least one destination so Notifications has somewhere to
              deliver.
            </p>
          ) : null}
        </div>
      </Field>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <SettingsBtn
          variant="primary"
          disabled={
            pending ||
            !draft.name.trim() ||
            draft.conditions.length === 0 ||
            draft.conditions.some(
              (c) =>
                c.type === "NO_EVENTS" &&
                c.eventScope === "specific" &&
                !c.eventName.trim()
            ) ||
            draft.destinationIds.length === 0
          }
          onClick={onSubmit}
        >
          {pending
            ? mode === "edit"
              ? "Saving…"
              : "Creating…"
            : submitLabel}
        </SettingsBtn>
        {onCancel ? (
          <SettingsBtn variant="ghost" disabled={pending} onClick={onCancel}>
            Cancel
          </SettingsBtn>
        ) : null}
      </div>
    </FieldGroup>
  );
}
