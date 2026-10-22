import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { createMiddleware } from 'hono/factory';
import { secureHeaders } from 'hono/secure-headers';
import { cspConnectSrc, isProduction } from './config.js';
import type { AppEnv } from './env.js';
import { ApiError } from './errors.js';
import { authOwnerRoutes } from './routes/auth-owner.js';
import { authStaffRoutes } from './routes/auth-staff.js';
import { ownerRoutes } from './routes/owner.js';
import { staffRoutes } from './routes/staff.js';
import { privacyPage } from './privacy.js';
import { readDb } from './db.js';
import { log } from './util/log.js';

/**
 * The Hono app. `/api/*` is the JSON API; everything else falls through to the dashboard's
 * static assets (configured in wrangler.jsonc) plus the privacy policy page.
 */
export const app = new Hono<AppEnv>()
  .use('*', async (c, next) => {
    c.set('requestId', c.req.header('cf-ray') ?? crypto.randomUUID().slice(0, 8));
    await next();
  })
  .use(
    '*',
    createMiddleware<AppEnv>((c, next) =>
      secureHeaders({
        strictTransportSecurity: 'max-age=63072000; includeSubDomains; preload',
        xFrameOptions: 'DENY',
        referrerPolicy: 'strict-origin-when-cross-origin',
        xContentTypeOptions: 'nosniff',
        permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
        contentSecurityPolicy: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: cspConnectSrc(c.env),
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          objectSrc: ["'none'"],
        },
      })(c, next),
    ),
  )
  // API responses carry tokens and personal data: never cacheable by browsers or proxies.
  .use('/api/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
    c.header('Pragma', 'no-cache');
  })
  /** Liveness: the isolate answers. */
  .get('/healthz', (c) => c.json({ ok: true, env: c.env.APP_ENV }))
  /**
   * Readiness: the database answers. Uptime checks point here. The failure body stays generic in
   * production; the driver's own message goes to the log.
   */
  .get('/readyz', async (c) => {
    try {
      await readDb(c).execute(sql`select 1 as one`);
      return c.json({ ok: true, db: true });
    } catch (e) {
      const err = e as Error & { cause?: Error & { code?: string } };
      log('error', 'readyz.db_failed', {
        requestId: c.var.requestId,
        error: err.message.slice(0, 200),
        causeMessage: err.cause?.message,
        causeCode: err.cause?.code,
      });
      return c.json(
        isProduction(c.env)
          ? { ok: false, db: false }
          : { ok: false, db: false, error: err.message.slice(0, 200), causeCode: err.cause?.code },
        503,
      );
    }
  })
  .get('/privacy', (c) => c.html(privacyPage()))
  /** Android test build, streamed from the private files bucket (uploaded with wrangler r2). */
  .get('/download/vamar-owner-app.apk', async (c) => {
    const obj = await c.env.FILES.get('releases/vamar-owner-app.apk');
    if (!obj) return c.text('Not available yet', 404);
    return new Response(obj.body, {
      headers: {
        'content-type': 'application/vnd.android.package-archive',
        'content-length': String(obj.size),
        'content-disposition': 'attachment; filename="vamar-owner-app.apk"',
        'cache-control': 'no-store',
      },
    });
  })
  .route('/api/auth/owner', authOwnerRoutes)
  .route('/api/auth/staff', authStaffRoutes)
  .route('/api/owner', ownerRoutes)
  .route('/api/staff', staffRoutes)
  .notFound((c) =>
    c.req.path.startsWith('/api/')
      ? c.json({ error: { code: 'not_found', message: 'Not found' } }, 404)
      : c.text('Not found', 404),
  )
  .onError((err, c) => {
    if (err instanceof ApiError) return c.json(err.toBody(), err.status);
    if (err instanceof HTTPException) {
      // Framework exceptions (body too large, bad JSON): same envelope as ApiError.
      return c.json(
        { error: { code: err.status === 400 ? 'validation' : 'http_error', message: err.message } },
        err.status,
      );
    }
    log('error', 'unhandled', {
      requestId: c.var.requestId,
      path: c.req.path,
      error: err instanceof Error ? err.message : String(err),
      cause: err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined,
      stack: err instanceof Error ? err.stack?.slice(0, 800) : undefined,
    });
    return c.json({ error: { code: 'internal', message: 'Something went wrong' } }, 500);
  });

export type AppType = typeof app;
