import {
  init as coreInit,
  ingestError,
  identify,
  trackEvent,
  trackError as coreTrackError,
  screen as coreScreen,
  getSessionId,
  endSession,
  SDK_VERSION,
  type TelemetryConfig,
} from "@telemetry-tracker/core";

type GlobalHandler = (error: Error, isFatal?: boolean) => void;
type NativeErrorUtils = {
  getGlobalHandler(): GlobalHandler;
  setGlobalHandler(handler: GlobalHandler): void;
};
const installed = new WeakSet<NativeErrorUtils>();

/** Identity must change for every distinct JS bundle, including embedded builds. */
export function buildBundleRelease(nativeVersion: string, bundleId: string): string {
  if (!nativeVersion.trim() || !bundleId.trim()) {
    throw new Error("nativeVersion and bundleId must be non-empty");
  }
  return `${encodeURIComponent(nativeVersion.trim())}+${encodeURIComponent(bundleId.trim())}`;
}

export type TelemetryReactNativeConfig = TelemetryConfig & {
  app: string;
  platform?: string;
};

export function init(config: TelemetryReactNativeConfig): void {
  coreInit({ ...config, platform: config.platform ?? "react-native" });

  const utils = (globalThis as typeof globalThis & { ErrorUtils?: NativeErrorUtils }).ErrorUtils;
  if (!utils?.setGlobalHandler || !utils.getGlobalHandler || installed.has(utils)) return;
  const previous = utils.getGlobalHandler();
  utils.setGlobalHandler((error, isFatal) => {
    // Core deduplicates manual and global reports of the same Error object.
    if (!isFatal) {
      try {
        coreTrackError(error, { source: "globalHandler", isFatal: false });
      } finally {
        previous(error, isFatal);
      }
      return;
    }
    // Bound the best-effort send so a stuck network cannot swallow the crash path.
    let forwarded = false;
    const forward = () => {
      if (forwarded) return;
      forwarded = true;
      clearTimeout(timer);
      previous(error, isFatal);
    };
    const timer = setTimeout(forward, 1000);
    try {
      void ingestError(error, { source: "globalHandler", isFatal: true }).then(forward, forward);
    } catch {
      forward();
    }
  });
  installed.add(utils);
}

export {
  identify,
  trackEvent,
  coreTrackError as trackError,
  coreScreen as screen,
  getSessionId,
  endSession,
  SDK_VERSION,
};

export function trackScreen(name: string): void {
  coreScreen(name);
}
