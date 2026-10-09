/** Operator monitoring policy. Mirrored across apps; regression tests enforce parity.
 * Every v10.66 category is explicit: partial dataCollection enables permissive defaults.
 * urlQueryParams and queues also cover the names introduced in the v11 migration guide.
 */
export const sentryPrivacyOptions = {
  sendDefaultPii: false,
  includeLocalVariables: false,
  tracesSampleRate: 0,
  tracePropagationTargets: [],
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  enableLogs: false,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: { request: false, response: false },
    httpBodies: [],
    queryParams: false,
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    stackFrameVariables: false,
    frameContextLines: 7,
    queues: false,
  },
  // Drop transactions even if a later init accidentally enables sampling.
  beforeSendTransaction: () => null,
};
