import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { createMiddleware } from 'hono/factory';
import { routePath } from 'hono/route';
import { secureHeaders } from 'hono/secure-headers';
import { cspConnectSrc, isDeployed, RECAPTCHA_FRAME_SRC, RECAPTCHA_SCRIPT_SRC } from './config.js';
import type { AppEnv } from './env.js';
import { ApiError } from './errors.js';
import { authOwnerRoutes } from './routes/auth-owner.js';
import { authStaffRoutes } from './routes/auth-staff.js';
import { ownerRoutes } from './routes/owner.js';
import { staffRoutes } from './routes/staff.js';
import { detectDevice, downloadPage } from './download.js';
import { privacyPage } from './privacy.js';
import { readDb } from './db.js';
import { log } from './util/log.js';
import { reportError } from './util/report.js';

export const MAX_JSON_BYTES = 1024 * 1024;
export const MAX_MULTIPART_BYTES = 11 * 1024 * 1024;

/**
 * The Hono app. `/api/*` is the JSON API; everything else falls through to the dashboard's
 * static assets (configured in wrangler.jsonc) plus the privacy policy page.
 */
export const app = new Hono<AppEnv>()
  // Request id on every response and one JSON access-log line per API call (no query string, no
  // body, no headers: nothing personal).
  .use(
    '*',
    createMiddleware<AppEnv>(async (c, next) => {
      const requestId = c.req.header('cf-ray') ?? crypto.randomUUID().slice(0, 8);
      c.set('requestId', requestId);
      const started = Date.now();
      await next();
      c.header('x-request-id', requestId);
      if (c.req.path.startsWith('/api/') || c.res.status >= 500) {
        log(c.res.status >= 500 ? 'error' : 'info', 'http', {
          requestId,
          method: c.req.method,
          route: routePath(c),
          status: c.res.status,
          ms: Date.now() - started,
          release: c.env.RELEASE,
        });
      }
    }),
  )
  .use(
    '*',
    createMiddleware<AppEnv>((c, next) =>
      secureHeaders({
        strictTransportSecurity: 'max-age=63072000; includeSubDomains; preload',
        xFrameOptions: 'DENY',
        referrerPolicy: 'strict-origin-when-cross-origin',
        xContentTypeOptions: 'nosniff',
        permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
        contentSecurityPolicy: c.req.path.startsWith('/app')
          ? {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", ...RECAPTCHA_SCRIPT_SRC],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:', 'blob:', 'https://www.gstatic.com'],
              fontSrc: ["'self'", 'data:'],
              connectSrc: [...cspConnectSrc(c.env), 'https://www.google.com'],
              frameSrc: RECAPTCHA_FRAME_SRC,
              workerSrc: ["'self'"],
              manifestSrc: ["'self'"],
              frameAncestors: ["'none'"],
              baseUri: ["'self'"],
              formAction: ["'self'"],
              objectSrc: ["'none'"],
            }
          : {
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
  // Request bodies: 11 MB for uploads (the 10 MB file limit plus the form envelope), 1 MB for
  // everything else. Checked from Content-Length and while streaming, before anything is parsed.
  .use(
    '/api/*',
    createMiddleware<AppEnv>((c, next) => {
      const multipart = (c.req.header('content-type') ?? '').startsWith('multipart/form-data');
      return bodyLimit({
        maxSize: multipart ? MAX_MULTIPART_BYTES : MAX_JSON_BYTES,
        onError: () => {
          throw new ApiError(413, 'payload_too_large', 'The request body is too large');
        },
      })(c, next);
    }),
  )
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
        isDeployed(c.env)
          ? { ok: false, db: false }
          : { ok: false, db: false, error: err.message.slice(0, 200), causeCode: err.cause?.code },
        503,
      );
    }
  })
  .get('/privacy', (c) => c.html(privacyPage()))
  /**
   * The owner web app, exported by Expo into the dashboard's dist/app. Files are served as they
   * are; any other /app path is an in-app route and gets the app's own index.html.
   */
  .get('/app', (c) => c.redirect('/app/', 301))
  .get('/app/*', async (c) => {
    if (!c.env.ASSETS) return c.notFound();
    const url = new URL(c.req.url);
    const isFile = /\.[a-z0-9]+$/i.test(url.pathname);
    const res = await c.env.ASSETS.fetch(
      isFile
        ? c.req.raw
        : new Request(new URL('/app/index.html', url).toString(), {
            method: 'GET',
            headers: c.req.raw.headers,
          }),
    );
    // The asset layer answers a missing file with the dashboard's index.html; a missing app file
    // (an old bundle after a deploy) must be a 404, never HTML served as a script.
    if (
      isFile &&
      !url.pathname.endsWith('.html') &&
      res.headers.get('content-type')?.startsWith('text/html')
    )
      return c.text('Not found', 404);
    const out = new Response(res.body, res);
    if (!isFile) out.headers.set('cache-control', 'no-cache');
    return out;
  })
  /**
   * Dashboard bundles. Hashed files are cached for a year; a missing one (an old chunk name after a
   * deploy) is a 404 that is never cached, not the dashboard's index.html under a year-long cache.
   */
  .get('/assets/*', async (c) => {
    if (!c.env.ASSETS) return c.notFound();
    const res = await c.env.ASSETS.fetch(c.req.raw);
    if (res.status === 200 && res.headers.get('content-type')?.startsWith('text/html')) {
      return c.text('Not found', 404, { 'cache-control': 'no-store' });
    }
    const out = new Response(res.body, res);
    if (res.status === 200) out.headers.set('cache-control', 'public, max-age=31536000, immutable');
    return out;
  })
  /** One link for owners: the right install option for the phone that opens it. */
  .get('/download', (c) =>
    c.html(
      downloadPage(detectDevice(c.req.header('user-agent')), c.env.APP_LATEST_VERSION ?? '1.0.0'),
    ),
  )
  /**
   * Update check for the owner app. Below `minimumVersion` the app shows a blocking "update
   * required" screen; below `latestVersion` a dismissible banner. Both link to `downloadUrl`.
   */
  .get('/api/app/version', (c) => {
    const origin = new URL(c.req.url).origin;
    return c.json({
      latestVersion: c.env.APP_LATEST_VERSION ?? '1.0.0',
      minimumVersion: c.env.APP_MIN_VERSION ?? '1.0.0',
      downloadUrl: `${origin}/download`,
      apkUrl: `${origin}/download/vamar-owner-app.apk`,
    });
  })
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
    const report = reportError(c.env, err, {
      source: 'request',
      requestId: c.var.requestId,
      route: routePath(c),
      method: c.req.method,
    });
    try {
      c.executionCtx.waitUntil(report);
    } catch {
      // No execution context (unit tests calling app.request directly): the log line is written.
      void report;
    }
    return c.json(
      { error: { code: 'internal', message: 'Something went wrong', requestId: c.var.requestId } },
      500,
    );
  });

export type AppType = typeof app;
