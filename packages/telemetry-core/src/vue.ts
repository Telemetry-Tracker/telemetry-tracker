import { trackError } from "./index.js";

/** Minimal shape of a Vue 3 app (`createApp()` / Nuxt `nuxtApp.vueApp`). No Vue dependency. */
export type VueAppLike = {
  config: {
    errorHandler?: ((err: unknown, instance: unknown, info: string) => unknown) | null | undefined;
  };
};

type VueInstanceLike = { $options?: { name?: unknown; __name?: unknown } } | null | undefined;

function componentName(instance: unknown): string | undefined {
  const opts = (instance as VueInstanceLike)?.$options;
  const name = opts?.name ?? opts?.__name;
  return typeof name === "string" && name ? name : undefined;
}

const INSTALLED = Symbol.for("telemetry-tracker.vue-error-handler");

/**
 * Report Vue component errors (render, lifecycle hooks, event handlers incl. async ones,
 * watchers) to Telemetry Tracker via `app.config.errorHandler`.
 *
 * Vue catches these errors itself, so they never reach `window.onerror` in production builds.
 * An existing `errorHandler` is chained (called after reporting). Without one, the error is
 * still logged with `console.error`, matching Vue's default behaviour. Idempotent per app.
 * Returns a function that restores the previous handler.
 */
export function installVueErrorHandler(app: VueAppLike): () => void {
  const cfg = app?.config as (VueAppLike["config"] & { [INSTALLED]?: boolean }) | undefined;
  if (!cfg) return () => {};
  if (cfg[INSTALLED]) return () => {};
  const previous = cfg.errorHandler ?? null;
  const handler = (err: unknown, instance: unknown, info: string): unknown => {
    try {
      const context: Record<string, unknown> = { source: "vue", vue_info: info };
      const component = componentName(instance);
      if (component) context.component = component;
      trackError(err, context);
    } catch {
      // never break the app because of telemetry
    }
    if (typeof previous === "function") {
      return previous.call(app.config, err, instance, info);
    }
    if (typeof console !== "undefined") console.error(err);
    return undefined;
  };
  cfg.errorHandler = handler;
  cfg[INSTALLED] = true;
  return () => {
    if (cfg.errorHandler === handler) cfg.errorHandler = previous;
    cfg[INSTALLED] = false;
  };
}
