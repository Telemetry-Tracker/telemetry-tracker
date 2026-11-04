/** Minimal shape of a Vue 3 app (`createApp()` / Nuxt `nuxtApp.vueApp`). No Vue dependency. */
export type VueAppLike = {
    config: {
        errorHandler?: ((err: unknown, instance: unknown, info: string) => unknown) | null | undefined;
    };
};
/**
 * Report Vue component errors (render, lifecycle hooks, event handlers incl. async ones,
 * watchers) to Telemetry Tracker via `app.config.errorHandler`.
 *
 * Vue catches these errors itself, so they never reach `window.onerror` in production builds.
 * An existing `errorHandler` is chained (called after reporting). Without one, the error is
 * still logged with `console.error`, matching Vue's default behaviour. Idempotent per app.
 * Returns a function that restores the previous handler.
 */
export declare function installVueErrorHandler(app: VueAppLike): () => void;
//# sourceMappingURL=vue.d.ts.map