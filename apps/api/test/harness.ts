/**
 * Test harness: in-process Postgres (PGlite) with the real migrations and seed, an in-memory R2
 * bucket, and helpers to call the Hono app as an owner or a staff member.
 */
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { SignJWT } from 'jose';
import { schema } from '@vamar/db';
import { seed, DEMO_OWNERS, DEMO_STAFF } from '@vamar/db/seed';
import type { PlainDate } from '@vamar/shared';
import { app } from '../src/app.js';
import type { Bindings, Principal } from '../src/env.js';
import { signAccessToken } from '../src/auth/tokens.js';
import type { Db } from '../src/db.js';

export const TODAY: PlainDate = '2026-10-07';

const require = createRequire(import.meta.url);
const dbPkgDir = dirname(require.resolve('@vamar/db/package.json'));

export class MemoryR2 implements Partial<R2Bucket> {
  store = new Map<string, { body: Uint8Array; meta: R2HTTPMetadata | undefined }>();
  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | string | null,
    options?: R2PutOptions,
  ) {
    let bytes: Uint8Array;
    if (value instanceof ReadableStream)
      bytes = new Uint8Array(await new Response(value).arrayBuffer());
    else if (typeof value === 'string') bytes = new TextEncoder().encode(value);
    else bytes = new Uint8Array(value ?? new ArrayBuffer(0));
    this.store.set(key, { body: bytes, meta: options?.httpMetadata as R2HTTPMetadata | undefined });
    return { key } as unknown as R2Object;
  }
  async get(key: string) {
    const v = this.store.get(key);
    if (!v) return null;
    const copy = new Uint8Array(v.body);
    return {
      key,
      body: new Blob([copy]).stream(),
      httpMetadata: v.meta,
      etag: 'test',
      arrayBuffer: () => Promise.resolve(copy.buffer),
    } as unknown as R2ObjectBody;
  }
  async delete(key: string | string[]) {
    for (const k of Array.isArray(key) ? key : [key]) this.store.delete(k);
  }
  async head(key: string) {
    return this.store.has(key) ? ({ key } as unknown as R2Object) : null;
  }
}

export interface TestWorld {
  db: Db;
  env: Bindings;
  client: PGlite;
  r2: MemoryR2;
  ctx: ExecutionContext;
  waitUntilPromises: Promise<unknown>[];
  flush: () => Promise<void>;
  close: () => Promise<void>;
  request: (path: string, init?: RequestInit & { token?: string }) => Promise<Response>;
  json: <T = unknown>(
    path: string,
    init?: RequestInit & { token?: string },
  ) => Promise<{ status: number; body: T }>;
  ownerToken: (phone: string) => Promise<string>;
  staffToken: (email: string, opts?: { mfa?: boolean }) => Promise<string>;
  firebaseToken: (claims: Record<string, unknown>) => Promise<string>;
  ids: { owners: Record<string, string>; staff: Record<string, string> };
}

export async function createWorld(): Promise<TestWorld> {
  const client = new PGlite();
  const db = drizzle({ client, schema, casing: 'snake_case' }) as unknown as Db;
  await client.exec(`CREATE ROLE vamar_app LOGIN PASSWORD 'vamar_app'`);
  await migrate(db as never, { migrationsFolder: join(dbPkgDir, 'migrations') });
  await seed(db as never, TODAY);

  const r2 = new MemoryR2();
  const waitUntilPromises: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => void waitUntilPromises.push(p),
    passThroughOnException: () => undefined,
    props: {},
  } as unknown as ExecutionContext;

  const env: Bindings = {
    FILES: r2 as unknown as R2Bucket,
    DATABASE_URL: 'test',
    JWT_SECRET: 'test-secret-test-secret-test-secret-test-secret',
    TOTP_ENC_KEY: 'dGVzdC10b3RwLWtleS0zMi1ieXRlcy1sb25nLXRlc3Qh',
    FIREBASE_PROJECT_ID: 'demo-vamar',
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
    ALLOWED_PHONE_COUNTRIES: 'AE',
    APP_ENV: 'test',
    TEST_DB: db,
    TEST_TODAY: TODAY,
  };

  // The seed has only admin + data entry (the client's two users); tests also need a read-only viewer.
  await db.insert(schema.staffUsers).values({
    email: 'viewer@vamar.test',
    name: 'Test Viewer',
    role: 'viewer',
    firebaseUid: 'seed-staff-viewer',
    active: true,
  });
  const ownerRows = await db
    .select({ id: schema.owners.id, phone: schema.owners.phoneE164 })
    .from(schema.owners);
  const staffRows = await db
    .select({
      id: schema.staffUsers.id,
      email: schema.staffUsers.email,
      role: schema.staffUsers.role,
    })
    .from(schema.staffUsers);
  const ids = {
    owners: Object.fromEntries(ownerRows.map((o) => [o.phone, o.id])),
    staff: Object.fromEntries(staffRows.map((s) => [s.email, s.id])),
  };

  const request = (path: string, init: RequestInit & { token?: string } = {}) => {
    const { token, ...rest } = init;
    const headers = new Headers(rest.headers);
    if (token) headers.set('authorization', `Bearer ${token}`);
    if (rest.body && typeof rest.body === 'string' && !headers.has('content-type'))
      headers.set('content-type', 'application/json');
    return Promise.resolve(app.request(`http://test${path}`, { ...rest, headers }, env, ctx));
  };

  const sign = async (principal: Principal) => signAccessToken(env, principal);

  return {
    db,
    env,
    client,
    r2,
    ctx,
    ids,
    waitUntilPromises,
    flush: async () => {
      await Promise.allSettled(waitUntilPromises.splice(0));
    },
    close: () => client.close(),
    request,
    json: async <T>(path: string, init?: RequestInit & { token?: string }) => {
      const res = await request(path, init);
      const text = await res.text();
      let body: T;
      try {
        body = JSON.parse(text) as T;
      } catch {
        body = text as unknown as T;
      }
      return { status: res.status, body };
    },
    ownerToken: async (phone) => {
      const id = ids.owners[phone];
      if (!id) throw new Error(`unknown owner ${phone}`);
      const [s] = await db
        .insert(schema.sessions)
        .values({
          subjectType: 'owner',
          subjectId: id,
          deviceId: 'test-device',
          tokenHash: crypto.randomUUID(),
          expiresAt: new Date(Date.now() + 3_600_000),
        })
        .returning({ id: schema.sessions.id });
      return sign({
        type: 'owner',
        id,
        sessionId: s?.id ?? crypto.randomUUID(),
        deviceId: 'test-device',
      });
    },
    staffToken: async (email, opts = {}) => {
      const row = staffRows.find((s) => s.email === email);
      if (!row) throw new Error(`unknown staff ${email}`);
      const mfa = opts.mfa ?? true;
      let sessionId = crypto.randomUUID();
      if (mfa) {
        const [s] = await db
          .insert(schema.sessions)
          .values({
            subjectType: 'staff',
            subjectId: row.id,
            deviceId: null,
            tokenHash: crypto.randomUUID(),
            expiresAt: new Date(Date.now() + 3_600_000),
          })
          .returning({ id: schema.sessions.id });
        sessionId = s?.id ?? sessionId;
      }
      return sign({ type: 'staff', id: row.id, sessionId, role: row.role, mfa });
    },
    /** Emulator-style unsigned Firebase ID token (alg none) accepted when FIREBASE_AUTH_EMULATOR_HOST is set. */
    firebaseToken: async (claims) => {
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const now = Math.floor(Date.now() / 1000);
      const payload = Buffer.from(
        JSON.stringify({
          iss: 'https://securetoken.google.com/demo-vamar',
          aud: 'demo-vamar',
          iat: now,
          exp: now + 3600,
          sub: 'fb-' + crypto.randomUUID(),
          ...claims,
        }),
      ).toString('base64url');
      return `${header}.${payload}.`;
    },
  };
}

export { DEMO_OWNERS, DEMO_STAFF, SignJWT, eq };
