import { describe, expect, it } from "vitest";
import {
  CONNECT_APP_FRAMEWORKS,
  connectAppHref,
  connectAppSnippets,
  frameworkDocsHref,
  frameworkLabel,
  resolveOverviewSetupBanner,
  resumeStepForApp,
} from "./connect-app-setup";

describe("connect-app-setup", () => {
  it("lists frameworks with docs", () => {
    expect(CONNECT_APP_FRAMEWORKS.length).toBeGreaterThan(3);
    expect(frameworkLabel("nextjs")).toBe("Next.js");
    expect(frameworkDocsHref("node")).toBe("/docs/node");
    expect(frameworkDocsHref("unknown")).toBe("/docs/sdk");
  });

  it("embeds app name and key in nextjs snippets", () => {
    const s = connectAppSnippets("nextjs", {
      appName: "storefront",
      apiKey: "tt_live_test_secret",
    });
    expect(s.install).toContain("@telemetry-tracker/next");
    expect(s.env).toContain("storefront");
    expect(s.env).toContain("tt_live_test_secret");
    expect(s.init).toContain("TelemetryProvider");
    expect(s.verify).toContain("app_connected");
    expect(s.fullExample).toContain("TelemetryProvider");
  });

  it("resumeStepForApp preserves install for connected / view-only", () => {
    expect(
      resumeStepForApp({ connected: true, hasActiveKey: false, viewOnly: false })
    ).toBe("install");
    expect(
      resumeStepForApp({ connected: false, hasActiveKey: false, viewOnly: true })
    ).toBe("install");
    expect(
      resumeStepForApp({ connected: false, hasActiveKey: false })
    ).toBe("key");
    expect(
      resumeStepForApp({ connected: false, hasActiveKey: true })
    ).toBe("install");
  });

  it("connectAppHref encodes app and view params", () => {
    expect(connectAppHref()).toBe("/dashboard/apps/connect");
    expect(connectAppHref("storefront")).toBe(
      "/dashboard/apps/connect?app=storefront"
    );
    expect(connectAppHref("storefront", true)).toBe(
      "/dashboard/apps/connect?app=storefront&view=1"
    );
  });

  it("resolveOverviewSetupBanner distinguishes never-telemetry vs quiet window", () => {
    expect(
      resolveOverviewSetupBanner({
        eventsCount: 1,
        errorsCount: 0,
        selectedApp: "a",
        projectApps: [],
      }).mode
    ).toBe("none");

    expect(
      resolveOverviewSetupBanner({
        eventsCount: 0,
        errorsCount: 0,
        selectedApp: "storefront",
        projectApps: [
          { name: "storefront", connected: false, firstEventAt: null },
        ],
      })
    ).toEqual({ mode: "finish_setup", appName: "storefront" });

    expect(
      resolveOverviewSetupBanner({
        eventsCount: 0,
        errorsCount: 0,
        selectedApp: "storefront",
        projectApps: [
          {
            name: "storefront",
            connected: true,
            firstEventAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      })
    ).toEqual({ mode: "quiet_window", appName: "storefront" });

    expect(
      resolveOverviewSetupBanner({
        eventsCount: 0,
        errorsCount: 0,
        selectedApp: null,
        projectApps: [],
      })
    ).toEqual({ mode: "project_empty", appName: null });
  });
});
