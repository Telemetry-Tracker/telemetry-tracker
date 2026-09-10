import { describe, expect, it } from "vitest";
import { HOSTED_API_URL } from "./hosted-cloud";
import {
  nextInstall,
  nextProviderSetup,
  nextTestError,
  nodeSetup,
  reactNativeSetup,
  reactSetup,
} from "./sdk-setup-snippets";

describe("sdk setup snippets", () => {
  it("uses the hosted ingest URL and published package names", () => {
    expect(nextInstall).toContain("@telemetry-tracker/next");
    expect(nextProviderSetup).toContain(HOSTED_API_URL);
    expect(nextProviderSetup).toContain("TelemetryProvider");
    expect(nextTestError).toContain("trackError");

    expect(reactSetup).toContain("@telemetry-tracker/core");
    expect(reactSetup).toContain(HOSTED_API_URL);

    expect(nodeSetup).toContain("@telemetry-tracker/node");
    expect(nodeSetup).toContain(HOSTED_API_URL);

    expect(reactNativeSetup).toContain("@telemetry-tracker/react-native");
    expect(reactNativeSetup).toContain("Platform.OS");
    expect(reactNativeSetup).toContain(HOSTED_API_URL);
  });
});
