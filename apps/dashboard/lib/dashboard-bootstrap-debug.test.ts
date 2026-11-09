import { describe, expect, it } from "vitest";
import { bootstrapDebugDetail } from "./dashboard-bootstrap-debug";

describe("bootstrapDebugDetail", () => {
  it("never includes a session id field", () => {
    const detail = bootstrapDebugDetail({
      hasSession: true,
      hasProject: true,
      hasOrg: false,
    });
    expect(detail).toEqual({
      hasSession: true,
      hasProject: true,
      hasOrg: false,
    });
    expect(JSON.stringify(detail)).not.toMatch(/sessionId|telemetry_session|bootstrap:/i);
  });
});
