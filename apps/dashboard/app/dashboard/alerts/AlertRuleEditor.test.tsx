import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { AlertRuleEditor } from "./AlertRuleEditor";
import {
  createDefaultAlertRuleDraft,
  draftFromAlertRule,
  type AlertRuleFormDraft,
} from "@/lib/alert-rules";

afterEach(cleanup);

function Harness({
  initial,
  onDraft,
}: {
  initial: AlertRuleFormDraft;
  onDraft: (d: AlertRuleFormDraft) => void;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <AlertRuleEditor
      mode="create"
      draft={draft}
      onChange={(d) => {
        setDraft(d);
        onDraft(d);
      }}
      destinations={[]}
      pending={false}
      onSubmit={() => {}}
      submitLabel="Create rule"
    />
  );
}

describe("AlertRuleEditor heartbeat conditions", () => {
  it("switches a condition to No events with event name, hours and cooldown", () => {
    const onDraft = vi.fn();
    render(<Harness initial={createDefaultAlertRuleDraft()} onDraft={onDraft} />);

    fireEvent.change(screen.getByLabelText("Condition 1 type"), {
      target: { value: "NO_EVENTS" },
    });
    expect(screen.queryByLabelText("Condition 1 threshold")).toBeNull();
    expect(
      (screen.getByLabelText("Condition 1 window hours") as HTMLInputElement).value
    ).toBe("6");
    expect((screen.getByLabelText("Cooldown minutes") as HTMLInputElement).value).toBe(
      "360"
    );

    fireEvent.change(screen.getByLabelText("Condition 1 event name"), {
      target: { value: "signup_verified" },
    });
    const last = onDraft.mock.calls.at(-1)![0] as AlertRuleFormDraft;
    expect(last.conditions[0]).toMatchObject({
      type: "NO_EVENTS",
      eventName: "signup_verified",
      windowHours: 6,
    });
    expect(screen.getByText(/no recovery/i)).toBeTruthy();
  });

  it("still opens existing ERROR_COUNT rules with their fields", () => {
    const draft = draftFromAlertRule({
      id: "r",
      name: "Spike",
      enabled: true,
      destinationIds: ["project-email"],
      cooldownMinutes: 15,
      createdAt: "",
      updatedAt: "",
      conditions: [
        { type: "ERROR_COUNT", threshold: 7, windowMinutes: 30, environment: null },
      ],
    });
    render(<Harness initial={draft} onDraft={() => {}} />);
    expect(
      (screen.getByLabelText("Condition 1 type") as HTMLSelectElement).value
    ).toBe("ERROR_COUNT");
    expect(
      (screen.getByLabelText("Condition 1 threshold") as HTMLInputElement).value
    ).toBe("7");
  });
});
