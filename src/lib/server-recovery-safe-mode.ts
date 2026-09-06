/** Main injects this immutable flag into a replacement Next utility process. */
export function isServerRecoverySafeMode(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.CODEPILOT_RECOVERY_SAFE_MODE === '1';
}
