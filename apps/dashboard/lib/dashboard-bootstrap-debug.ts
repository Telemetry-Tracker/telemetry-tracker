/** Safe fields for bootstrap coalesce logs — never include the session bearer secret. */
export function bootstrapDebugDetail(input: {
  hasSession: boolean;
  hasProject: boolean;
  hasOrg: boolean;
}): { hasSession: boolean; hasProject: boolean; hasOrg: boolean } {
  return {
    hasSession: input.hasSession,
    hasProject: input.hasProject,
    hasOrg: input.hasOrg,
  };
}
