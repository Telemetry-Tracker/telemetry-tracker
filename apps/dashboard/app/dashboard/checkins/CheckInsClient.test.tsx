import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const { action } = vi.hoisted(() => ({ action: vi.fn() }));
vi.mock("./actions", () => ({ checkInAction: action }));
import { CheckInsClient } from "./CheckInsClient";
const monitor = { id: "m", name: "Backup", status: "UP", schedule_type: "INTERVAL" as const, interval_seconds: 300, cron_expr: null, timezone: "UTC", grace_seconds: 60, max_runtime_seconds: null, destination_ids: [], last_ping_at: null, next_due_at: null, checkin_path: "/checkin/secret" };
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("Check-ins dashboard", () => {
  it("shows status and history but no secret controls to viewers", () => {
    render(<CheckInsClient initial={{ monitors: [monitor], canEdit: false, evaluator: "ok", apiBaseUrl: "https://api.example" }} />);
    expect(screen.getByText("Backup")).toBeTruthy(); expect(screen.getByText("UP")).toBeTruthy(); expect(screen.getByRole("button", { name: "History" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "URL" })).toBeNull(); expect(screen.queryByRole("button", { name: "Rotate URL" })).toBeNull(); expect(screen.queryByRole("button", { name: "Create monitor" })).toBeNull(); expect(screen.queryByDisplayValue(/checkin/)).toBeNull();
  });
  it("shows the evaluator warning when stale", () => {
    render(<CheckInsClient initial={{ monitors: [], canEdit: false, evaluator: "unavailable", apiBaseUrl: "https://api.example" }} />);
    expect(screen.getByRole("alert").textContent).toContain("evaluator is unavailable");
  });
  it("preserves the public URL base across a refresh", async () => {
    action.mockResolvedValue({ monitors: [monitor], canEdit: true, evaluator: "ok" });
    render(<CheckInsClient initial={{ monitors: [monitor], canEdit: true, evaluator: "ok", apiBaseUrl: "https://custom-api.example/" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Refresh" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "URL" }));
    expect((screen.getByLabelText("Secret check-in URL") as HTMLInputElement).value).toBe("https://custom-api.example/checkin/secret");
  });
});
