import { describe, expect, it, vi } from 'vitest';
import { checkTarget, excerptOf, isOkBody, probe, type FetchFn } from '../src/check';

const target = { name: 'production', base: 'https://a.example.dev', readyEveryMinutes: 30 };
const opts = { timeoutMs: 15_000, retryDelayMs: 20_000, tries: 2 };

const answer = (body: string, status = 200) => Promise.resolve(new Response(body, { status }));

function deps(fetchFn: FetchFn) {
  let clock = 0;
  const sleep = vi.fn((ms: number) => {
    clock += ms;
    return Promise.resolve();
  });
  return { fetch: fetchFn, sleep, now: () => clock };
}

describe('isOkBody and excerptOf', () => {
  it('needs a JSON object with ok true', () => {
    expect(isOkBody('{"ok":true,"db":true}')).toBe(true);
    expect(isOkBody('{"ok":false,"db":false}')).toBe(false);
    expect(isOkBody('{"ok":"true"}')).toBe(false);
    expect(isOkBody('<html>ok</html>')).toBe(false);
    expect(isOkBody('true')).toBe(false);
    expect(isOkBody('')).toBe(false);
  });

  it('keeps printable text without backticks, 300 characters at most', () => {
    expect(excerptOf('a`b\u0000cé\nd')).toBe('abc\nd');
    expect(excerptOf('x'.repeat(500))).toHaveLength(300);
    expect(excerptOf('  ')).toBe('(empty body)');
  });
});

describe('probe', () => {
  it('is up on 200 with ok true and sends no-cache', async () => {
    const fetchFn = vi.fn<FetchFn>(() => answer('{"ok":true,"db":true}'));
    expect(await probe('https://a.example.dev/readyz', fetchFn, 15_000)).toEqual({
      up: true,
      code: '200',
      excerpt: '{"ok":true,"db":true}',
    });
    const init = fetchFn.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({ 'cache-control': 'no-cache' });
    expect(init?.redirect).toBe('manual');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('is down on 503, on 200 without ok true, and on a redirect', async () => {
    expect(await probe('u', () => answer('{"ok":false,"db":false}', 503), 1000)).toMatchObject({
      up: false,
      code: '503',
      excerpt: '{"ok":false,"db":false}',
    });
    expect(await probe('u', () => answer('<html></html>'), 1000)).toMatchObject({
      up: false,
      code: '200',
    });
    expect(await probe('u', () => answer('', 302), 1000)).toMatchObject({ up: false, code: '302' });
  });

  it('reports 000 when nothing answers', async () => {
    const timeout = () => Promise.reject(new DOMException('timed out', 'TimeoutError'));
    expect(await probe('u', timeout, 15_000)).toEqual({
      up: false,
      code: '000',
      excerpt: 'no answer within 15 s',
    });
    const refused = () => Promise.reject(new TypeError('fetch failed: connection refused'));
    expect(await probe('u', refused, 15_000)).toEqual({
      up: false,
      code: '000',
      excerpt: 'fetch failed: connection refused',
    });
  });
});

describe('checkTarget', () => {
  it('stops after the first good answer', async () => {
    const d = deps(() => answer('{"ok":true}'));
    const r = await checkTarget(target, '/healthz', d, opts);
    expect(r).toMatchObject({ up: true, attempts: 1, url: 'https://a.example.dev/healthz' });
    expect(d.sleep).not.toHaveBeenCalled();
  });

  it('retries once after the delay and is up when the retry answers', async () => {
    const fetchFn = vi
      .fn<FetchFn>()
      .mockImplementationOnce(() => answer('', 502))
      .mockImplementationOnce(() => answer('{"ok":true,"db":true}'));
    const d = deps(fetchFn);
    const r = await checkTarget(target, '/readyz', d, opts);
    expect(r).toMatchObject({ up: true, code: '200', attempts: 2, path: '/readyz' });
    expect(d.sleep).toHaveBeenCalledExactlyOnceWith(20_000);
    expect(r.ms).toBe(20_000);
  });

  it('is down with the last answer when every try fails', async () => {
    const fetchFn = vi
      .fn<FetchFn>()
      .mockImplementationOnce(() => Promise.reject(new TypeError('fetch failed')))
      .mockImplementationOnce(() => answer('{"ok":false,"db":false}', 503));
    const d = deps(fetchFn);
    const r = await checkTarget(target, '/readyz', d, opts);
    expect(r).toMatchObject({ up: false, code: '503', attempts: 2 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(d.sleep).toHaveBeenCalledTimes(1);
  });
});
