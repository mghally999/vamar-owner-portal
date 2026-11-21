/**
 * The server side of signing out, kept apart from the auth provider so the order can be tested
 * without rendering it.
 */
export interface EndSessionSteps {
  readRefreshToken: () => Promise<string | null>;
  forgetPushToken: () => Promise<void>;
  logout: (refreshToken: string) => Promise<unknown>;
}

/**
 * Removes this phone's push token, then ends the session. The token for /logout is read only
 * after the push call: that call may refresh the session (401, then rotate), and the token read
 * before it would already be spent, leaving the new session live on the server.
 */
export async function endServerSession(steps: EndSessionSteps): Promise<void> {
  // Never signed in on this phone: nothing to end.
  if (!(await steps.readRefreshToken())) return;
  // First, while the session still lets it: this phone stops receiving the owner's pushes.
  await steps.forgetPushToken();
  const refreshToken = await steps.readRefreshToken();
  if (!refreshToken) return;
  try {
    await steps.logout(refreshToken);
  } catch {
    // Best effort: the phone forgets the session either way.
  }
}
