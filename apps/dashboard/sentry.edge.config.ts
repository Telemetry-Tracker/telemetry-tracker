import * as Sentry from "@sentry/nextjs";
import { getServerSentryDsn, sentryInitOptions } from "./lib/sentry";

const dsn = getServerSentryDsn();
if (dsn) {
  Sentry.init(sentryInitOptions(dsn));
}
