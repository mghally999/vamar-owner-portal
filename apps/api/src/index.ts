import { app } from './app.js';
import { runDailyJobs } from './cron.js';
import type { Bindings } from './env.js';

export default {
  fetch: (request: Request, env: Bindings, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  scheduled: (_controller: ScheduledController, env: Bindings, ctx: ExecutionContext) => {
    ctx.waitUntil(runDailyJobs(env));
  },
} satisfies ExportedHandler<Bindings>;

export type { AppType } from './app.js';
