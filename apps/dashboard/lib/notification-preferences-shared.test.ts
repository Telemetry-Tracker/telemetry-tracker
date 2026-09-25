import { describe, expect, it } from "vitest";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "./notification-preferences-shared";

describe("DEFAULT_NOTIFICATION_PREFERENCES", () => {
  it("turns the email channel on so alert routing is not silently dropped", () => {
    expect(DEFAULT_NOTIFICATION_PREFERENCES.channels.email).toBe(true);
    expect(DEFAULT_NOTIFICATION_PREFERENCES.routing.alerts.email).toBe(true);
    expect(DEFAULT_NOTIFICATION_PREFERENCES.routing.issues.email).toBe(false);
  });
});
