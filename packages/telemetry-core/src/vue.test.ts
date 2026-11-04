import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { init, shutdown, installVueErrorHandler, type VueAppLike } from "./index.js";

// Regression for TT-034 (#919): Vue swallows component errors in production builds
// (console.error only), so window.onerror never sees them and nothing was reported.
describe("installVueErrorHandler (#919)", () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    init({ ingestUrl: "http://ingest.test", app: "vue-test", apiKey: "k", batchInterval: 0, webVitals: false });
  });
  afterEach(() => {
    shutdown();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const errorCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/ingest/error"));

  it("reports an error thrown in a real Vue component", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const Boom = defineComponent({
      name: "BoomComp",
      setup() {
        throw new Error("vue-setup-boom");
      },
    });
    const app = createSSRApp({ render: () => h(Boom) });
    installVueErrorHandler(app);
    await renderToString(app).catch(() => {});
    await new Promise((r) => setTimeout(r, 0));
    expect(errorCalls()).toHaveLength(1);
    const body = JSON.parse(errorCalls()[0][1].body);
    expect(body.message).toBe("vue-setup-boom");
    expect(body.context).toMatchObject({ source: "vue", component: "BoomComp" });
    expect(typeof body.context.vue_info).toBe("string");
  });

  it("chains an existing errorHandler and does not double-log", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const prev = vi.fn();
    const app: VueAppLike = { config: { errorHandler: prev } };
    installVueErrorHandler(app);
    const e = new Error("chained");
    app.config.errorHandler!(e, null, "native event handler");
    expect(prev).toHaveBeenCalledWith(e, null, "native event handler");
    expect(err).not.toHaveBeenCalled();
    expect(errorCalls()).toHaveLength(1);
  });

  it("keeps Vue's console.error when there was no handler, is idempotent and uninstallable", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const app: VueAppLike = { config: {} };
    const off = installVueErrorHandler(app);
    const h1 = app.config.errorHandler;
    installVueErrorHandler(app);
    expect(app.config.errorHandler).toBe(h1);
    app.config.errorHandler!(new Error("x"), null, "render function");
    expect(err).toHaveBeenCalledTimes(1);
    expect(errorCalls()).toHaveLength(1);
    off();
    expect(app.config.errorHandler).toBeFalsy();
  });

  it("is a no-op before init and never throws", () => {
    shutdown();
    const app: VueAppLike = { config: {} };
    vi.spyOn(console, "error").mockImplementation(() => {});
    installVueErrorHandler(app);
    expect(() => app.config.errorHandler!("str", null, "x")).not.toThrow();
    expect(errorCalls()).toHaveLength(0);
  });
});
