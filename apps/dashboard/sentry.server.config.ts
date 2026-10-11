import * as Sentry from "@sentry/nextjs";
import {
  dashboardServerHttpIntegrationOptions,
  getServerSentryDsn,
  replaceHttpIntegration,
  sentryInitOptions,
} from "./lib/sentry";

const dsn = getServerSentryDsn();
if (dsn) {
  // `@sentry/nextjs` 10.66.0 puts its own Http integration in `defaultIntegrations`.
  // An `integrations` callback replaces that list, so return every other integration
  // unchanged and swap only Http.
  Sentry.init({
    ...sentryInitOptions(dsn),
    integrations(integrations) {
      return replaceHttpIntegration(
        integrations,
        Sentry.httpIntegration(dashboardServerHttpIntegrationOptions)
      );
    },
  });
}
