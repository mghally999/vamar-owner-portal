import { app } from './app.js';
import { validateEnv } from './config.js';
import { runDailyJobs } from './cron.js';
import type { Bindings } from './env.js';
import { log } from './util/log.js';

const misconfigured = (problems: string[]): Response => {
  log('error', 'config.invalid', { problems });
  return new Response(
    JSON.stringify({ error: { code: 'internal', message: 'Service is not configured' } }),
    { status: 500, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
  );
};

export default {
  fetch: (request: Request, env: Bindings, ctx: ExecutionContext) => {
    const problems = validateEnv(env);
    if (problems.length) return misconfigured(problems);
    return app.fetch(request, env, ctx);
  },
  scheduled: (controller: ScheduledController, env: Bindings, ctx: ExecutionContext) => {
    const problems = validateEnv(env);
    if (problems.length) {
      log('error', 'config.invalid', { problems, cron: controller.cron });
      return;
    }
    ctx.waitUntil(
      runDailyJobs(env).catch((e: unknown) => {
        log('error', 'cron.failed', {
          cron: controller.cron,
          error: e instanceof Error ? e.message : String(e),
          stack: e instanceof Error ? e.stack?.slice(0, 800) : undefined,
        });
      }),
    );
  },
} satisfies ExportedHandler<Bindings>;

export type { AppType } from './app.js';
