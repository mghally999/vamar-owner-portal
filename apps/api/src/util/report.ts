/**
 * Error reporting. Every unexpected failure goes through `reportError`: it is always logged as
 * JSON, and when `SENTRY_DSN` is configured it is also sent to Sentry as an event tagged with the
 * environment and the release. Nothing personal leaves the Worker: no request body, no headers,
 * no query string, phone numbers and e-mail addresses masked in the message.
 *
 * Talks to Sentry's envelope endpoint directly (one fetch, no SDK) to stay inside the Worker CPU
 * budget and the bundle size.
 */
import type { Bindings } from '../env.js';
import { log } from './log.js';

export interface ErrorContext {
  requestId?: string | undefined;
  route?: string | undefined;
  method?: string | undefined;
  /** 'request' | 'cron' | 'waitUntil' */
  source: string;
  extra?: Record<string, string | number | boolean | null | undefined>;
}

interface ParsedDsn {
  endpoint: string;
  publicKey: string;
}

function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\//, '');
    if (!u.username || !projectId) return null;
    return {
      endpoint: `${u.protocol}//${u.host}/api/${projectId}/envelope/`,
      publicKey: u.username,
    };
  } catch {
    return null;
  }
}

/** Masks phone numbers and e-mail addresses that may appear inside error messages. */
export function scrub(text: string): string {
  return text
    .replace(/\+?\d[\d\s-]{7,}\d/g, (m) => `***${m.replace(/\D/g, '').slice(-3)}`)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, (m) => `${m.slice(0, 1)}***@${m.split('@')[1] ?? ''}`);
}

function hex32(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export function buildSentryEvent(
  env: Pick<Bindings, 'APP_ENV' | 'RELEASE'>,
  error: unknown,
  ctx: ErrorContext,
) {
  const err = error instanceof Error ? error : new Error(String(error));
  const frames = (err.stack ?? '')
    .split('\n')
    .slice(1, 30)
    .map((line) => {
      const m = /at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line.trim());
      return m
        ? { function: m[1] ?? '?', filename: m[2], lineno: Number(m[3]), colno: Number(m[4]) }
        : { function: line.trim() };
    })
    .reverse();
  return {
    event_id: hex32(),
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    level: 'error',
    environment: env.APP_ENV,
    release: env.RELEASE ?? 'unknown',
    server_name: 'vamar-api',
    transaction: ctx.route ? `${ctx.method ?? ''} ${ctx.route}`.trim() : ctx.source,
    tags: { source: ctx.source, ...(ctx.requestId ? { request_id: ctx.requestId } : {}) },
    extra: ctx.extra ?? {},
    exception: {
      values: [
        {
          type: err.name,
          value: scrub(err.message).slice(0, 500),
          stacktrace: { frames },
        },
      ],
    },
  };
}

export async function reportError(env: Bindings, error: unknown, ctx: ErrorContext): Promise<void> {
  const err = error instanceof Error ? error : new Error(String(error));
  log('error', ctx.source === 'request' ? 'unhandled' : `${ctx.source}.failed`, {
    requestId: ctx.requestId,
    route: ctx.route,
    method: ctx.method,
    error: scrub(err.message).slice(0, 300),
    cause: err.cause instanceof Error ? scrub(err.cause.message).slice(0, 200) : undefined,
    stack: err.stack?.slice(0, 800),
    release: env.RELEASE,
  });
  if (!env.SENTRY_DSN || env.APP_ENV === 'test') return;
  const dsn = parseDsn(env.SENTRY_DSN);
  if (!dsn) return;
  const event = buildSentryEvent(env, err, ctx);
  const envelope = [
    JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event),
  ].join('\n');
  try {
    await fetch(dsn.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-sentry-envelope',
        'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=vamar-api/1.0`,
      },
      body: envelope,
      signal: AbortSignal.timeout(5_000),
    });
  } catch (e) {
    log('warn', 'sentry.send_failed', { error: e instanceof Error ? e.message : String(e) });
  }
}
