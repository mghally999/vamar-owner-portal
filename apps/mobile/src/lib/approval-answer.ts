/**
 * What a refused answer means. The API answers 409 when the request was answered meanwhile
 * (another device, approval by silence) or the job already started: sending again would fail
 * every time, so the screen refreshes to the request's current state instead of asking to retry.
 */

/** A 409 from the answer endpoint: the request no longer takes an answer. */
export function isAlreadyAnswered(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 409;
}

/** The cached queries a refused answer makes stale; none for any other failure. */
export function staleAfterAnswerError(error: unknown, id: string): string[][] {
  return isAlreadyAnswered(error) ? [['approval', id], ['approvals'], ['work-orders']] : [];
}
