/** Platform version from the repo CHANGELOG, injected by next.config.ts at build time. */
export function getBuildPlatformVersion(): string | undefined {
  return process.env.TT_PLATFORM_VERSION?.trim() || undefined;
}
