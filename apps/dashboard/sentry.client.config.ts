import * as Sentry from "@sentry/nextjs";
import { getClientSentryDsn, sentryInitOptions } from "./lib/sentry";

const dsn = getClientSentryDsn();
if (dsn) {
  Sentry.init(sentryInitOptions(dsn));
}
