/**
 * Per-isolate memory of sessions recently confirmed active, so most requests skip one database
 * round trip. Every revocation in this isolate forgets the sessions it revoked at once (see
 * `revokeSessions` in tokens.ts); other isolates notice within SESSION_CHECK_CACHE_MS.
 */
export const SESSION_CHECK_CACHE_MS = 60_000;
const activeUntil = new Map<string, number>();

export function isCachedActive(sessionId: string, now = Date.now()): boolean {
  const until = activeUntil.get(sessionId);
  return until !== undefined && until > now;
}

export function rememberActive(sessionId: string, now = Date.now()): void {
  if (activeUntil.size > 10_000) activeUntil.clear();
  activeUntil.set(sessionId, now + SESSION_CHECK_CACHE_MS);
}

/** Forget one session (or all of them), so the next request checks the database. */
export function forgetSession(sessionId?: string): void {
  if (sessionId) activeUntil.delete(sessionId);
  else activeUntil.clear();
}
