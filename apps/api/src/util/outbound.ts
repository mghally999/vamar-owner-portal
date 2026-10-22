/**
 * Every call that leaves the Worker (Expo push, R2, Google JWKS) goes through here so it has a
 * deadline and, when the operation is safe to repeat, a bounded number of retries with jittered
 * backoff. Nothing hangs until the platform kills it, and a transient failure is reported as such.
 */

export class OutboundError extends Error {
  constructor(
    readonly kind: 'timeout' | 'network' | 'http',
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface RetryOptions {
  /** Deadline for one attempt. */
  timeoutMs?: number;
  /** Extra attempts after the first one. */
  retries?: number;
  /** Base delay; doubles per attempt with jitter. */
  backoffMs?: number;
  /** Which responses are worth another attempt (default: 429 and 5xx). */
  retryOn?: (res: Response) => boolean;
  label?: string;
}

const defaultRetryOn = (res: Response) => res.status === 429 || res.status >= 500;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Run a promise-returning operation against a deadline. */
export async function withTimeout<T>(op: () => Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new OutboundError('timeout', `${label} timed out`));
    }, ms);
  });
  try {
    return await Promise.race([op(), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * `fetch` with a per-attempt timeout and retries on network errors and retryable statuses. Returns
 * the final response (which may still be a 4xx/5xx the caller inspects) or throws an
 * `OutboundError` when every attempt failed to produce a response.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: RetryOptions = {},
): Promise<Response> {
  const {
    timeoutMs = 10_000,
    retries = 2,
    backoffMs = 400,
    retryOn = defaultRetryOn,
    label = url,
  } = options;
  let lastError: OutboundError | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (!retryOn(res) || attempt === retries) return res;
      lastError = new OutboundError('http', `${label} answered ${res.status}`, res.status);
    } catch (e) {
      const timedOut = e instanceof Error && e.name === 'TimeoutError';
      lastError = new OutboundError(
        timedOut ? 'timeout' : 'network',
        `${label} ${timedOut ? 'timed out' : 'failed'}: ${e instanceof Error ? e.message : String(e)}`,
      );
      if (attempt === retries) throw lastError;
    }
    const delay = backoffMs * 2 ** attempt;
    await sleep(delay / 2 + Math.random() * (delay / 2));
  }
  throw lastError ?? new OutboundError('network', `${label} failed`);
}
