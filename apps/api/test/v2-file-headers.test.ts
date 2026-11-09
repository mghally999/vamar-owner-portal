/**
 * File downloads keep their own strict policy: the app-wide security headers run after the
 * handler and used to overwrite the `sandbox` CSP that streamObject sets, so an invoice, a
 * cheque image or a court paper could render with the page policy instead.
 */
import { and, eq } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, type TestWorld } from './harness.js';

let w: TestWorld;
let attachmentId: string;

beforeAll(async () => {
  w = await createWorld();
  // The seeded lift repair invoice (Al Noor Tower, Khalid's building).
  const [row] = await w.db
    .select({ id: schema.attachments.id })
    .from(schema.attachments)
    .where(
      and(
        eq(schema.attachments.entityType, 'expense'),
        eq(schema.attachments.fileName, 'invoice-GL-2026-0417.jpg'),
      ),
    );
  if (!row) throw new Error('seeded lift invoice not found');
  attachmentId = row.id;
});
afterAll(() => w.close());

function expectSandboxed(res: Response) {
  const csp = res.headers.get('content-security-policy') ?? '';
  expect(csp).toContain('sandbox');
  expect(csp).toContain("default-src 'none'");
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  expect(res.headers.get('cache-control')).toContain('no-store');
}

describe('file download headers', () => {
  it('an owner invoice download keeps the sandbox policy', async () => {
    const token = await w.ownerToken('+971500000001');
    const res = await w.request(`/api/owner/attachments/${attachmentId}`, { token });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expectSandboxed(res);
  });

  it('a staff download keeps the sandbox policy', async () => {
    const token = await w.staffToken('viewer@vamar.test');
    const res = await w.request(`/api/staff/attachments/${attachmentId}`, { token });
    expect(res.status).toBe(200);
    expectSandboxed(res);
  });

  it('a JSON response keeps the page policy, without sandbox', async () => {
    const token = await w.ownerToken('+971500000001');
    const res = await w.request('/api/owner/me', { token });
    expect(res.status).toBe(200);
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('sandbox');
  });
});
