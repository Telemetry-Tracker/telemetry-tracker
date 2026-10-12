import { beforeEach, describe, expect, it, vi } from "vitest";
import { dashboardApiFetch } from "@/lib/dashboard-api";
import { checkInAction } from "./actions";

vi.mock("@/lib/dashboard-api", () => ({ dashboardApiFetch: vi.fn() }));
const id = "12345678-1234-1234-1234-123456789abc";

beforeEach(() => {
  vi.mocked(dashboardApiFetch).mockReset();
  vi.mocked(dashboardApiFetch).mockResolvedValue(new Response("{}"));
});

describe("check-in action API paths", () => {
  it.each(["", "pause", "resume", "rotate-token", "checkins"])("uses the fixed suffix for %s", async (action) => {
    await checkInAction("POST", id.toUpperCase(), action);
    expect(dashboardApiFetch).toHaveBeenCalledWith(
      `/api/project/checkin-monitors/${id}${action ? `/${action}` : ""}`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("supports collection requests", async () => {
    await checkInAction("GET");
    expect(dashboardApiFetch).toHaveBeenCalledWith("/api/project/checkin-monitors", expect.anything());
  });

  it.each(["-".repeat(36), "a".repeat(36), `${id}/..`, `${id}?q=x`, `${id}#x`, "https://evil.example", "//evil.example", "../other"])("rejects invalid monitor %s before fetching", async (value) => {
    await expect(checkInAction("DELETE", value)).rejects.toThrow("Invalid monitor");
    expect(dashboardApiFetch).not.toHaveBeenCalled();
  });

  it.each(["../pause", "pause?x=1", "//evil.example", "constructor"])("rejects invalid action %s before fetching", async (action) => {
    await expect(checkInAction("POST", id, action)).rejects.toThrow("Invalid action");
    expect(dashboardApiFetch).not.toHaveBeenCalled();
  });

  it("requires a monitor for resource actions", async () => {
    await expect(checkInAction("POST", "", "pause")).rejects.toThrow("Invalid monitor");
    expect(dashboardApiFetch).not.toHaveBeenCalled();
  });
});
