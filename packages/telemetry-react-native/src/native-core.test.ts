import { afterEach, expect, it, vi } from "vitest";
import { shutdown } from "@telemetry-tracker/core";
import { init, trackError } from "./index.js";
afterEach(() => { shutdown(); vi.unstubAllGlobals(); });
it("deduplicates manual capture followed by a fatal global report", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
  vi.stubGlobal("fetch", fetch);
  const previous = vi.fn();
  let handler!: (error: Error, fatal?: boolean) => void;
  vi.stubGlobal("ErrorUtils", { getGlobalHandler: () => previous, setGlobalHandler: (h: typeof handler) => { handler = h; } });
  init({ app: "mobile", ingestUrl: "https://example.com", apiKey: "key" });
  const error = Object.freeze(new Error("fatal"));
  trackError(error);
  handler(error, true);
  await vi.waitFor(() => expect(previous).toHaveBeenCalledExactlyOnceWith(error, true));
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("/ingest/error"))).toHaveLength(1);
});
