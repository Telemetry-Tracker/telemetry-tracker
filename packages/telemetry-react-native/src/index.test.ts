import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const core = vi.hoisted(() => ({ init: vi.fn(), trackError: vi.fn(), ingestError: vi.fn() }));
vi.mock("@telemetry-tracker/core", () => ({
  ...core, identify: vi.fn(), trackEvent: vi.fn(), screen: vi.fn(),
  getSessionId: vi.fn(), endSession: vi.fn(), SDK_VERSION: "test",
}));
import { init, buildBundleRelease } from "./index.js";
const config = { app: "mobile", ingestUrl: "https://example.com", apiKey: "key" };
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); core.ingestError.mockResolvedValue(undefined); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function setup() {
  const previous = vi.fn();
  const utils = { getGlobalHandler: () => previous, setGlobalHandler: vi.fn() };
  vi.stubGlobal("ErrorUtils", utils);
  init(config);
  return { previous, utils, handler: utils.setGlobalHandler.mock.calls[0][0] };
}
describe("native global handler", () => {
  it("defaults platform and preserves explicit overrides", () => {
    init(config); expect(core.init).toHaveBeenLastCalledWith({ ...config, platform: "react-native" });
    init({ ...config, platform: "ios" }); expect(core.init).toHaveBeenLastCalledWith({ ...config, platform: "ios" });
  });
  it("installs once and forwards nonfatal errors after capture", () => {
    const { previous, utils, handler } = setup(); init(config);
    expect(utils.setGlobalHandler).toHaveBeenCalledOnce();
    const error = new Error("boom"); handler(error, false);
    expect(core.trackError).toHaveBeenCalledWith(error, { source: "globalHandler", isFatal: false });
    expect(previous).toHaveBeenCalledWith(error, false);
    expect(core.trackError.mock.invocationCallOrder[0]).toBeLessThan(previous.mock.invocationCallOrder[0]);
  });
  it("waits for fatal ingest then forwards exactly once", async () => {
    const { previous, handler } = setup(); const error = new Error("fatal"); handler(error, true);
    expect(previous).not.toHaveBeenCalled(); await vi.runAllTimersAsync();
    expect(core.ingestError).toHaveBeenCalledWith(error, { source: "globalHandler", isFatal: true });
    expect(previous).toHaveBeenCalledExactlyOnceWith(error, true);
  });
  it("forwards fatal errors after timeout even if ingest hangs", async () => {
    let resolve!: () => void;
    core.ingestError.mockReturnValue(new Promise<void>((r) => { resolve = r; }));
    const { previous, handler } = setup(); handler(new Error("fatal"), true);
    await vi.advanceTimersByTimeAsync(1000); expect(previous).toHaveBeenCalledOnce();
    resolve(); await Promise.resolve(); expect(previous).toHaveBeenCalledOnce();
  });
  it("preserves previous behavior when capture rejects or throws", async () => {
    const { previous, handler } = setup();
    core.ingestError.mockRejectedValueOnce(new Error("network")); handler(new Error("fatal"), true);
    await Promise.resolve(); expect(previous).toHaveBeenCalledOnce();
    core.ingestError.mockImplementationOnce(() => { throw new Error("capture"); });
    handler(new Error("fatal2"), true); expect(previous).toHaveBeenCalledTimes(2);
  });
  it("does not overwrite a handler it cannot retrieve", () => {
    const setGlobalHandler = vi.fn(); vi.stubGlobal("ErrorUtils", { setGlobalHandler });
    init(config); expect(setGlobalHandler).not.toHaveBeenCalled();
  });
});
it("requires a bundle identity and creates distinct encoded releases", () => {
  expect(buildBundleRelease("1.0", "android:embedded:42")).toBe("1.0+android%3Aembedded%3A42");
  expect(buildBundleRelease("1.0", "update-a")).not.toBe(buildBundleRelease("1.0", "update-b"));
  expect(() => buildBundleRelease("1", " ")).toThrow();
});
