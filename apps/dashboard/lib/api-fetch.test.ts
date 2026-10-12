// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { apiFetch } from "./api-fetch";
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ "x-real-ip": "104.16.0.1", "cf-connecting-ip": "203.0.113.7" })) }));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("forwards authenticated visitor identity and preserves request options", async () => {
  vi.stubEnv("AFFILIATE_CLIENT_IP_FORWARD_SECRET", "test-secret");
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response());
  vi.stubGlobal("fetch", fetch);
  await apiFetch("http://api/api/auth/login", { method: "POST", body: "body", headers: new Headers({ Authorization: "Bearer session" }) });
  const init = fetch.mock.calls[0]?.[1] as RequestInit;
  expect(init.method).toBe("POST");
  expect(init.body).toBe("body");
  const headers = new Headers(init.headers);
  expect(headers.get("authorization")).toBe("Bearer session");
  expect(headers.get("x-tt-client-ip")).toBe("203.0.113.7");
  expect(headers.get("x-tt-client-ip-secret")).toBe("test-secret");
});
it.each([false, true])("does not send forwarding credentials without a secret or in the browser (%s)", async (browser) => {
  vi.stubEnv("AFFILIATE_CLIENT_IP_FORWARD_SECRET", browser ? "test-secret" : "");
  if (browser) vi.stubGlobal("window", {});
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response());
  vi.stubGlobal("fetch", fetch);
  await apiFetch("http://api/api/meta/projects", { headers: { "x-tt-client-ip-secret": "injected", "x-tt-client-ip": "1.1.1.1" } });
  const headers = new Headers((fetch.mock.calls[0]?.[1] as RequestInit).headers);
  expect(headers.has("x-tt-client-ip-secret")).toBe(false);
  expect(headers.has("x-tt-client-ip")).toBe(false);
});
it("sends the request without forwarding when called outside a request scope", async () => {
  vi.stubEnv("AFFILIATE_CLIENT_IP_FORWARD_SECRET", "test-secret");
  const nextHeaders = await import("next/headers");
  vi.mocked(nextHeaders.headers).mockRejectedValueOnce(new Error("outside request scope"));
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response());
  vi.stubGlobal("fetch", fetch);
  await apiFetch("http://api/api/meta/projects");
  const headers = new Headers((fetch.mock.calls[0]?.[1] as RequestInit).headers);
  expect(headers.has("x-tt-client-ip-secret")).toBe(false);
});
