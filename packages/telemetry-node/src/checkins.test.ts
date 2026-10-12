import { afterEach, describe, expect, it, vi } from "vitest";
const { trackError } = vi.hoisted(() => ({ trackError: vi.fn() }));
vi.mock("@telemetry-tracker/core", async importOriginal => ({ ...await importOriginal<typeof import("@telemetry-tracker/core")>(), trackError }));
import { withCheckIn } from "./index.js";
afterEach(() => vi.unstubAllGlobals());
describe("withCheckIn", () => {
  it("sends start and success with one UUID and preserves results", async () => {
    const fetch = vi.fn(async () => new Response("OK")); vi.stubGlobal("fetch", fetch);
    expect(await withCheckIn("https://api.test/checkin/secret", () => 42)).toBe(42);
    const urls = fetch.mock.calls.map(args => String((args as unknown[])[0]));
    expect(new URL(urls[0]).pathname).toBe("/checkin/secret/start");
    expect(new URL(urls[1]).pathname).toBe("/checkin/secret");
    expect(new URL(urls[0]).searchParams.get("rid")).toBe(new URL(urls[1]).searchParams.get("rid"));
  });
  it.each(["header", "url"] as const)("supports %s token transport", async tokenTransport => {
    const fetch = vi.fn().mockResolvedValue(new Response("OK")); vi.stubGlobal("fetch", fetch);
    const token = `ttc_${"a".repeat(64)}`;
    await withCheckIn(`https://api.test/checkin/${token}`, () => 42, tokenTransport === "url" ? { tokenTransport } : {});
    const [target, options] = fetch.mock.calls[0];
    expect(new URL(String(target)).pathname).toBe(tokenTransport === "header" ? "/checkin/start" : `/checkin/${token}/start`);
    expect(options.headers).toEqual(tokenTransport === "header" ? { "X-TT-Checkin-Token": token } : {});
  });
  it("reports failure and preserves the thrown error", async () => {
    const fetch = vi.fn(async () => new Response("OK")); vi.stubGlobal("fetch", fetch);
    const error = new Error("backup failed");
    await expect(withCheckIn("https://api.test/checkin/secret", () => { throw error; }, { monitorName: "Backup" })).rejects.toBe(error);
    expect(String((fetch.mock.calls[1] as unknown[])[0])).toContain("/fail?rid=");
    expect(trackError).toHaveBeenCalledWith(error, { checkin: "Backup", checkin_run_id: new URL(String((fetch.mock.calls[1] as unknown[])[0])).searchParams.get("rid") });
  });
  it("retries network and 5xx errors without failing the job", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValue(new Response("OK")); vi.stubGlobal("fetch", fetch);
    expect(await withCheckIn("https://api.test/checkin/secret", () => "done")).toBe("done");
    expect(fetch).toHaveBeenCalledTimes(4);
  });
  it("runs jobs even when every ping fails or the URL is invalid", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await withCheckIn("https://api.test/checkin/secret", () => true)).toBe(true);
    expect(await withCheckIn("invalid", () => true)).toBe(true);
  });
});
