/**
 * Resolves the Run_Token: `token` when non-empty, otherwise `githubToken`
 * when non-empty, otherwise `defaultToken`.
 */
export function resolveRunToken(token: string, githubToken: string, defaultToken: string): string {
  if (token !== '') return token;
  if (githubToken !== '') return githubToken;
  return defaultToken;
}

/**
 * Every value that must be masked in the workflow log for a Run_Token
 * (Requirement 7.2): the token, its base64 form `base64("x-access-token:" + token)`,
 * and the full Authorization header value that `credentialEnv` builds.
 * Empty when the token is empty.
 */
export function credentialMaskValues(runToken: string): string[] {
  if (runToken === '') return [];
  const b64 = Buffer.from(`x-access-token:${runToken}`).toString('base64');
  return [runToken, b64, `AUTHORIZATION: basic ${b64}`];
}
