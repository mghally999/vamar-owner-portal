import { health, readStatus, runOnce, type Env } from './run';

export type { Env } from './run';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

/**
 * GET /readyz: 200 {"ok":true} while the cron runs and can write issues, 503 with the reason
 * otherwise (uptime.yml watches this). GET /status: what the last run saw.
 */
export async function handleRequest(request: Request, env: Env, now: number): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
  if (pathname === '/readyz') {
    const status = await readStatus(env.STATE);
    const h = health(status, now);
    return h.ok
      ? json({ ok: true, lastRun: status?.at ?? null })
      : json({ ok: false, reason: h.reason, lastRun: status?.at ?? null }, 503);
  }
  if (pathname === '/' || pathname === '/status') {
    const status = await readStatus(env.STATE);
    return status ? json(status) : json({ error: 'no run recorded yet' }, 404);
  }
  return json({ error: 'not found' }, 404);
}

export default {
  async scheduled(controller, env) {
    const status = await runOnce(env, controller.scheduledTime, {
      fetch: (input, init) => fetch(input, init),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
    });
    // A run that could not reach GitHub shows as failed in the Worker's cron event list and logs.
    if (status.alerts !== 'off' && !status.github.ok) {
      throw new Error(`alerts not delivered: ${status.github.error ?? 'GitHub error'}`);
    }
  },
  fetch: (request, env) => handleRequest(request, env, Date.now()),
} satisfies ExportedHandler<Env>;
