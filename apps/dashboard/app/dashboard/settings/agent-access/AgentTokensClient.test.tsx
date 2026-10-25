import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { AgentTokensClient } from "./AgentTokensClient";
import { createAgentToken, revokeAgentToken } from "./actions";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./actions", () => ({ createAgentToken: vi.fn(), revokeAgentToken: vi.fn() }));
const data = { defaultProjectId: "first", projects: [{ id: "first", name: "First" }, { id: "second", name: "Second" }], tokens: [] };
beforeEach(() => { cleanup(); vi.clearAllMocks(); });
describe("agent token settings", () => {
  it("defaults to exactly the current project and 90 days", () => {
    render(<AgentTokensClient data={data} />);
    const checks = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(checks[0]?.checked).toBe(true); expect(checks[1]?.checked).toBe(false);
    expect((screen.getByLabelText("Expires after days (maximum 365)") as HTMLInputElement).value).toBe("90");
  });
  it("sends explicit scope and dismisses the once-shown secret", async () => {
    vi.mocked(createAgentToken).mockResolvedValue({ token: "tt_read_test_secret" });
    render(<AgentTokensClient data={data} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Agent" } });
    fireEvent.click(screen.getByText("Second"));
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    await waitFor(() => expect(createAgentToken).toHaveBeenCalledWith({ name: "Agent", projectIds: ["first", "second"], expiryDays: 90 }));
    expect(await screen.findByText("tt_read_test_secret")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" })); expect(screen.queryByText("tt_read_test_secret")).toBeNull();
  });
  it("revokes by token ID and displays failures without a secret", async () => {
    vi.mocked(revokeAgentToken).mockResolvedValue({ error: "Could not revoke token." });
    render(<AgentTokensClient data={{ ...data, tokens: [{ id: "token-id", name: "Agent", project_ids: ["first"], expires_at: "2099-01-01", revoked_at: null, last_used_at: null, usage_count: 2, last_tool: "list_issues" }] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(revokeAgentToken).toHaveBeenCalledWith("token-id"));
    expect((await screen.findByRole("alert")).textContent).toContain("Could not revoke token.");
  });
});
