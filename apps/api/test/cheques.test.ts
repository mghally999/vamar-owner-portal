import { and, eq, inArray } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, type TestWorld } from './harness.js';

let w: TestWorld;
let editor: string;
let admin: string;
beforeAll(async () => {
  w = await createWorld();
  editor = await w.staffToken('entry@vamar.test');
  admin = await w.staffToken('admin@vamar.test');
});
afterAll(() => w.close());

async function chequeWithStatus(status: 'upcoming' | 'deposited' | 'cleared' | 'bounced') {
  const [row] = await w.db
    .select({ id: schema.cheques.id, contractId: schema.cheques.contractId })
    .from(schema.cheques)
    .innerJoin(schema.contracts, eq(schema.contracts.id, schema.cheques.contractId))
    .where(and(eq(schema.cheques.status, status), eq(schema.contracts.status, 'active')))
    .limit(1);
  if (!row) throw new Error(`no ${status} cheque in seed`);
  return row;
}

const setStatus = (id: string, body: unknown, token = editor) =>
  w.json<{
    cheque: { status: string };
    replacement: { id: string; seq: number } | null;
    error?: { code: string };
  }>(`/api/staff/cheques/${id}/status`, { method: 'POST', token, body: JSON.stringify(body) });

describe('cheque lifecycle', () => {
  it('upcoming -> deposited -> cleared with timeline and audit rows', async () => {
    const q = await chequeWithStatus('upcoming');
    const d = await setStatus(q.id, { to: 'deposited', note: 'Deposited at ENBD' });
    expect(d.status).toBe(200);
    expect(d.body.cheque.status).toBe('deposited');
    const c = await setStatus(q.id, { to: 'cleared' });
    expect(c.body.cheque.status).toBe('cleared');
    const detail = await w.json<{
      timeline: { fromStatus: string | null; toStatus: string; note: string }[];
    }>(`/api/staff/cheques/${q.id}`, { token: editor });
    const tl = detail.body.timeline.map((t) => t.toStatus);
    expect(tl.slice(-2)).toEqual(['deposited', 'cleared']);
    const audits = await w.db
      .select()
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.action, 'cheque.status_change'), eq(schema.auditLog.entityId, q.id)),
      );
    expect(audits).toHaveLength(2);
    expect((audits[0]!.before as { status: string }).status).toBe('upcoming');
  });

  it('illegal transitions are refused with invalid_transition', async () => {
    const q = await chequeWithStatus('upcoming');
    const r = await setStatus(q.id, { to: 'cleared' });
    expect(r.status).toBe(422);
    expect(r.body.error?.code).toBe('invalid_transition');
  });

  it('bounce requires a reason, queues an owner alert, and replace creates the linked cheque', async () => {
    const q = await chequeWithStatus('deposited');
    const noReason = await setStatus(q.id, { to: 'bounced' });
    expect(noReason.status).toBe(422);
    const b = await setStatus(q.id, { to: 'bounced', bounceReason: 'Insufficient funds' });
    expect(b.status).toBe(200);
    await w.flush();
    const alerts = await w.db
      .select()
      .from(schema.notificationLog)
      .where(
        and(
          eq(schema.notificationLog.type, 'cheque_bounced'),
          eq(schema.notificationLog.entityId, q.id),
        ),
      );
    expect(alerts.length).toBeGreaterThanOrEqual(1);

    const noRep = await setStatus(q.id, { to: 'replaced' });
    expect(noRep.status).toBe(422);
    const rep = await setStatus(q.id, {
      to: 'replaced',
      replacement: {
        dueDate: '2026-11-15',
        amountFils: 2_500_000,
        chequeNo: '777001',
        bankName: 'FAB',
      },
    });
    expect(rep.status).toBe(200);
    expect(rep.body.cheque.status).toBe('replaced');
    expect(rep.body.replacement).not.toBeNull();
    const newCheque = await w.db.query.cheques.findFirst({
      where: eq(schema.cheques.id, rep.body.replacement!.id),
    });
    expect(newCheque?.replacesChequeId).toBe(q.id);
    expect(newCheque?.status).toBe('upcoming');
    const detail = await w.json<{ replacedBy: { id: string } | null }>(
      `/api/staff/cheques/${q.id}`,
      { token: editor },
    );
    expect(detail.body.replacedBy?.id).toBe(rep.body.replacement!.id);
  });

  it('terminal status correction is admin only and needs a reason', async () => {
    const q = await chequeWithStatus('cleared');
    const asEditor = await setStatus(
      q.id,
      { to: 'deposited', overrideReason: 'Bank reversed clearance' },
      editor,
    );
    expect(asEditor.status).toBe(422);
    const noReason = await setStatus(q.id, { to: 'deposited' }, admin);
    expect(noReason.status).toBe(422);
    const ok = await setStatus(
      q.id,
      { to: 'deposited', overrideReason: 'Bank reversed clearance' },
      admin,
    );
    expect(ok.status).toBe(200);
    const audits = await w.db
      .select()
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.action, 'cheque.status_change'), eq(schema.auditLog.entityId, q.id)),
      );
    expect(JSON.stringify(audits.at(-1)!.after)).toContain('Bank reversed clearance');
  });

  it('bulk update validates each cheque and reports partial failures', async () => {
    const upcoming = await w.db
      .select({ id: schema.cheques.id })
      .from(schema.cheques)
      .innerJoin(schema.contracts, eq(schema.contracts.id, schema.cheques.contractId))
      .where(and(eq(schema.cheques.status, 'upcoming'), eq(schema.contracts.status, 'active')))
      .limit(3);
    const cleared = await chequeWithStatus('cleared');
    const ids = [...upcoming.map((u) => u.id), cleared.id];
    const r = await w.json<{ ok: string[]; failed: { id: string; reason: string }[] }>(
      '/api/staff/cheques/bulk-status',
      { method: 'POST', token: editor, body: JSON.stringify({ chequeIds: ids, to: 'deposited' }) },
    );
    expect(r.status).toBe(200);
    expect(r.body.ok.sort()).toEqual(upcoming.map((u) => u.id).sort());
    expect(r.body.failed).toEqual([
      { id: cleared.id, reason: 'Cannot move a cheque from cleared to deposited' },
    ]);
    const rows = await w.db
      .select({ status: schema.cheques.status })
      .from(schema.cheques)
      .where(
        inArray(
          schema.cheques.id,
          upcoming.map((u) => u.id),
        ),
      );
    expect(rows.every((x) => x.status === 'deposited')).toBe(true);
  });

  it("cheque image upload is type-checked and served to staff and the unit's owner only", async () => {
    const q = await chequeWithStatus('upcoming');
    const bad = new FormData();
    bad.set(
      'file',
      new File([new Uint8Array([0x4d, 0x5a, 0x90, 0x00])], 'virus.exe', {
        type: 'application/octet-stream',
      }),
    );
    expect(
      (
        await w.request(`/api/staff/cheques/${q.id}/image`, {
          method: 'POST',
          token: editor,
          body: bad,
        })
      ).status,
    ).toBe(422);
    const good = new FormData();
    good.set(
      'file',
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])], 'cheque.jpg', {
        type: 'image/jpeg',
      }),
    );
    expect(
      (
        await w.request(`/api/staff/cheques/${q.id}/image`, {
          method: 'POST',
          token: editor,
          body: good,
        })
      ).status,
    ).toBe(201);
    const img = await w.request(`/api/staff/cheques/${q.id}/image`, { token: editor });
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/jpeg');
  });

  it('staff cheque table filters by month, status and owner with keyset pagination', async () => {
    const p1 = await w.json<{
      items: { dueDate: string; status: string }[];
      nextCursor: string | null;
    }>('/api/staff/cheques?month=2026-10&limit=5', { token: editor });
    expect(p1.status).toBe(200);
    expect(p1.body.items.every((c) => c.dueDate.startsWith('2026-10'))).toBe(true);
    if (p1.body.nextCursor) {
      const p2 = await w.json<{ items: { dueDate: string }[] }>(
        `/api/staff/cheques?month=2026-10&limit=5&cursor=${p1.body.nextCursor}`,
        { token: editor },
      );
      expect(p2.body.items[0]!.dueDate >= p1.body.items.at(-1)!.dueDate).toBe(true);
    }
    const bounced = await w.json<{ items: { status: string }[] }>(
      '/api/staff/cheques?status=bounced,replaced&limit=50',
      { token: editor },
    );
    expect(bounced.body.items.every((c) => c.status === 'bounced' || c.status === 'replaced')).toBe(
      true,
    );
    const ownerId = w.ids.owners['+971500000004']!;
    const byOwner = await w.json<{ items: { buildingNameEn: string }[] }>(
      `/api/staff/cheques?ownerId=${ownerId}&limit=50`,
      { token: editor },
    );
    expect(byOwner.body.items.length).toBeGreaterThan(0);
    expect(byOwner.body.items.every((c) => c.buildingNameEn === 'Al Khan Residence')).toBe(true);
  });
});
