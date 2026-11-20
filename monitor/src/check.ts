import type { Target } from './config';

export const USER_AGENT = 'vamar-uptime';

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface CheckDeps {
  fetch: FetchFn;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export interface CheckOptions {
  /** Per request, headers and body together. */
  timeoutMs: number;
  /** Pause before the next try after a failed one. */
  retryDelayMs: number;
  /** Tries in one run; the target is down only when every try fails. */
  tries: number;
}

/** Two tries 20 s apart, 15 s each: a target is reported down after about 50 s of failures. */
export const DEFAULT_CHECK: CheckOptions = { timeoutMs: 15_000, retryDelayMs: 20_000, tries: 2 };

export type Path = '/healthz' | '/readyz';

export interface ProbeResult {
  up: boolean;
  /** HTTP status as text; "000" when nothing answered (same convention as curl and uptime.yml). */
  code: string;
  excerpt: string;
}

export interface CheckResult extends ProbeResult {
  path: Path;
  url: string;
  attempts: number;
  ms: number;
}

/** Healthy answer: a JSON object with `"ok": true` (both /healthz and /readyz). */
export function isOkBody(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === true;
  } catch {
    return false;
  }
}

/** Printable ASCII and newlines only, no backticks (the excerpt goes inside a code block). */
export function excerptOf(text: string, max = 300): string {
  const clean = text
    .replace(/[^\x20-\x7E\n]/g, '')
    .replace(/`/g, '')
    .trim()
    .slice(0, max);
  return clean === '' ? '(empty body)' : clean;
}

export async function probe(
  url: string,
  fetchFn: FetchFn,
  timeoutMs: number,
): Promise<ProbeResult> {
  try {
    const res = await fetchFn(url, {
      headers: { 'cache-control': 'no-cache', 'user-agent': USER_AGENT },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    return {
      up: res.status === 200 && isOkBody(text),
      code: String(res.status),
      excerpt: excerptOf(text),
    };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    return {
      up: false,
      code: '000',
      excerpt: timedOut ? `no answer within ${timeoutMs / 1000} s` : excerptOf(err.message),
    };
  }
}

/** Calls `path` on the target; after a failed try waits and tries again, up to `opts.tries`. */
export async function checkTarget(
  target: Target,
  path: Path,
  deps: CheckDeps,
  opts: CheckOptions = DEFAULT_CHECK,
): Promise<CheckResult> {
  const url = target.base + path;
  const started = deps.now();
  for (let attempt = 1; ; attempt++) {
    const result = await probe(url, deps.fetch, opts.timeoutMs);
    if (result.up || attempt >= opts.tries) {
      return { ...result, path, url, attempts: attempt, ms: deps.now() - started };
    }
    await deps.sleep(opts.retryDelayMs);
  }
}
