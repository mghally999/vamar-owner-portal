import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import type { AppEnv } from './env.js';
import { ApiError } from './errors.js';
import { authOwnerRoutes } from './routes/auth-owner.js';
import { authStaffRoutes } from './routes/auth-staff.js';
import { ownerRoutes } from './routes/owner.js';
import { staffRoutes } from './routes/staff.js';
import { privacyPage } from './privacy.js';
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
    secureHeaders({
      strictTransportSecurity: 'max-age=63072000; includeSubDomains; preload',
      xFrameOptions: 'DENY',
      referrerPolicy: 'strict-origin-when-cross-origin',
      xContentTypeOptions: 'nosniff',
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: [
          "'self'",
          'https://*.googleapis.com',
          'https://*.firebaseapp.com',
          'http://127.0.0.1:9099',
          'http://localhost:9099',
        ],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
      },
    }),
  )
  .get('/healthz', (c) => c.json({ ok: true, env: c.env.APP_ENV }))
  .get('/privacy', (c) => c.html(privacyPage()))
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
      // zod-validator failures arrive here as 400s
      const res = err.getResponse();
      return new Response(res.body, { status: res.status, headers: res.headers });
    }
    log('error', 'unhandled', {
      requestId: c.var.requestId,
      path: c.req.path,
      error: err instanceof Error ? err.message : String(err),
      cause: err instanceof Error && err.cause !== undefined ? String(err.cause) : undefined,
      stack: err instanceof Error ? err.stack?.slice(0, 800) : undefined,
    });
    return c.json({ error: { code: 'internal', message: 'Something went wrong' } }, 500);
  });

export type AppType = typeof app;
