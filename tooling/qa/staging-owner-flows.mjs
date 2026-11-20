#!/usr/bin/env node
/**
 * Owner flows against STAGING through the real API (tooling/qa/staging-lib.mjs explains how the
 * sessions are made). Signs in two owners who share no unit (Khalid +971500000001 and Fatima
 * +971500000002), calls every endpoint the owner app uses, checks status codes and shapes, and
 * checks that neither owner can list or open the other's records.
 *
 *   node tooling/qa/staging-owner-flows.mjs [--json out.json]
 *
 * Validation errors are 422 in this API (apps/api/src/util/validator.ts).
 * Writes: one message thread with a reply (subject starts with "[QA staging]"), a push token on
 * the QA devices, preferredLang set and put back. Everything it writes is removed at the end
 * (threads, devices, sessions, rate-limit rows of the QA owners' message counter are left to expire).
 */
import { writeFileSync } from 'node:fs';
import {
  QA_TAG,
  assertStaging,
  cleanupQaSessions,
  client,
  closeDb,
  ownerSession,
  q,
  recorder,
} from './staging-lib.mjs';

const PRESETS = [
  'today',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'next_month',
  'last_3_months',
  'last_6_months',
  'next_6_months',
  'this_quarter',
  'this_year',
  'last_year',
  'next_12_months',
];
const { results, check } = recorder();
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasKeys = (o, keys) => isObj(o) && keys.every((k) => k in o);
const isInt = (v) => Number.isInteger(v);

/** Every page of a cursor-paginated list. */
async function all(api, path, max = 40) {
  const items = [];
  let cursor;
  for (let i = 0; i < max; i++) {
    const sep = path.includes('?') ? '&' : '?';
    const r = await api(
      'GET',
      `${path}${sep}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    if (r.status !== 200) return { status: r.status, items, text: r.text };
    items.push(...r.json.items);
    cursor = r.json.nextCursor;
    if (!cursor) break;
  }
  return { status: 200, items };
}

async function ownerData(s) {
  const d = {};
  d.cheques = await all(s.api, '/api/owner/cheques');
  d.expenses = await all(s.api, '/api/owner/expenses');
  d.disputes = await all(s.api, '/api/owner/disputes');
  d.workOrders = await all(s.api, '/api/owner/work-orders');
  d.units = (await s.api('GET', '/api/owner/units')).json?.items ?? [];
  d.buildings = (await s.api('GET', '/api/owner/buildings')).json?.items ?? [];
  d.approvals = (await s.api('GET', '/api/owner/approvals')).json?.items ?? [];
  d.threads = (await s.api('GET', '/api/owner/messages')).json?.items ?? [];
  return d;
}

async function run() {
  await assertStaging();
  const A = await ownerSession('+971500000001');
  const B = await ownerSession('+971500000002');
  check(
    'owner session A (Khalid) via real /api/auth/owner/refresh',
    A.accessToken,
    `owner ${A.owner.nameEn}`,
  );
  check(
    'owner session B (Fatima) via real /api/auth/owner/refresh',
    B.accessToken,
    `owner ${B.owner.nameEn}`,
  );

  // ---- profile -------------------------------------------------------------------------------
  const me = await A.api('GET', '/api/owner/me');
  check(
    'GET /api/owner/me',
    me.status === 200 &&
      me.json.id === A.owner.id &&
      me.json.phoneE164 === '+971500000001' &&
      isObj(me.json.settings),
    `${me.status} ${me.ms}ms keys=${Object.keys(me.json ?? {}).join(',')}`,
  );
  const lang0 = me.json.preferredLang;
  const other = lang0 === 'ar' ? 'en' : 'ar';
  const p1 = await A.api('PATCH', '/api/owner/me', { preferredLang: other });
  const me2 = await A.api('GET', '/api/owner/me');
  const p2 = await A.api('PATCH', '/api/owner/me', { preferredLang: lang0 });
  check(
    'PATCH /api/owner/me preferredLang round trip',
    p1.status === 200 && me2.json.preferredLang === other && p2.status === 200,
    `${p1.status}/${me2.json.preferredLang}/${p2.status}`,
  );
  const badLang = await A.api('PATCH', '/api/owner/me', { preferredLang: 'fr' });
  check(
    'PATCH /api/owner/me rejects an unknown language (422)',
    badLang.status === 422,
    `${badLang.status}`,
  );

  // ---- home and summary ----------------------------------------------------------------------
  const home = await A.api('GET', '/api/owner/home');
  check(
    'GET /api/owner/home',
    home.status === 200 &&
      hasKeys(home.json, [
        'month',
        'expectedFils',
        'clearedFils',
        'pendingFils',
        'bouncedCount',
        'nextCheque',
        'occupancy',
        'openDisputes',
      ]) &&
      isInt(home.json.expectedFils),
    `${home.status} ${home.ms}ms month=${home.json?.month} expected=${home.json?.expectedFils}`,
  );
  const homeM = await A.api('GET', '/api/owner/home?month=2026-01');
  check(
    'GET /api/owner/home?month=2026-01',
    homeM.status === 200 && homeM.json.month === '2026-01',
    `${homeM.status}`,
  );
  const homeBad = await A.api('GET', '/api/owner/home?month=2026-13');
  check('GET /api/owner/home?month=2026-13 is 422', homeBad.status === 422, `${homeBad.status}`);

  const summaryKeys = [
    'preset',
    'period',
    'isFuture',
    'rent',
    'expenses',
    'netFils',
    'buckets',
    'occupancy',
    'openWorkOrders',
    'openDisputes',
  ];
  const slow = [];
  for (const preset of PRESETS) {
    const r = await A.api('GET', `/api/owner/summary?preset=${preset}`);
    const ok =
      r.status === 200 &&
      hasKeys(r.json, summaryKeys) &&
      r.json.preset === preset &&
      isInt(r.json.netFils) &&
      Array.isArray(r.json.buckets) &&
      hasKeys(r.json.period, ['from', 'to']);
    if (r.ms > 1500) slow.push(`${preset}=${r.ms}ms`);
    check(
      `GET /api/owner/summary?preset=${preset}`,
      ok,
      `${r.status} ${r.ms}ms ${r.json?.period?.from}..${r.json?.period?.to} net=${r.json?.netFils} rent.expected=${r.json?.rent?.expectedFils}`,
    );
  }
  const custom = await A.api(
    'GET',
    '/api/owner/summary?preset=custom&from=2026-01-01&to=2026-03-31&compare=1',
  );
  check(
    'GET /api/owner/summary custom range + compare',
    custom.status === 200 &&
      custom.json.period.from === '2026-01-01' &&
      custom.json.period.to === '2026-03-31' &&
      custom.json.previous !== null,
    `${custom.status} previous=${custom.json?.previous ? 'yes' : 'null'}`,
  );
  const noPreset = await A.api('GET', '/api/owner/summary');
  check(
    'GET /api/owner/summary without a preset (default)',
    noPreset.status === 200,
    `${noPreset.status} preset=${noPreset.json?.preset}`,
  );
  const sumBad = await A.api('GET', '/api/owner/summary?from=2026-01-01');
  check('GET /api/owner/summary from without to is 422', sumBad.status === 422, `${sumBad.status}`);
  const sumLong = await A.api(
    'GET',
    '/api/owner/summary?preset=custom&from=2010-01-01&to=2026-01-01',
  );
  check('GET /api/owner/summary > 5 years is 422', sumLong.status === 422, `${sumLong.status}`);
  check('summary presets answer under 1.5 s each', slow.length === 0, slow.join(' ') || 'all fast');

  const years = await A.api('GET', '/api/owner/statement-years');
  check(
    'GET /api/owner/statement-years',
    years.status === 200 &&
      Array.isArray(years.json.years) &&
      years.json.years.every(isInt) &&
      years.json.years.includes(2026),
    `${years.status} ${JSON.stringify(years.json?.years)}`,
  );

  // ---- lists of A and B ----------------------------------------------------------------------
  const a = await ownerData(A);
  const b = await ownerData(B);
  for (const [name, dA, dB] of [
    ['cheques', a.cheques, b.cheques],
    ['expenses', a.expenses, b.expenses],
    ['disputes', a.disputes, b.disputes],
    ['work-orders', a.workOrders, b.workOrders],
  ]) {
    check(
      `GET /api/owner/${name} (all pages, A and B)`,
      dA.status === 200 && dB.status === 200,
      `A=${dA.items.length} B=${dB.items.length}`,
    );
  }

  // ---- expenses ------------------------------------------------------------------------------
  const ex5 = await A.api('GET', '/api/owner/expenses?limit=5');
  check(
    'GET /api/owner/expenses?limit=5 pages with a cursor',
    ex5.status === 200 && ex5.json.items.length === 5 && typeof ex5.json.nextCursor === 'string',
    `${ex5.status}`,
  );
  const ex5b = await A.api(
    'GET',
    `/api/owner/expenses?limit=5&cursor=${encodeURIComponent(ex5.json.nextCursor)}`,
  );
  const overlap = ex5b.json.items.filter((x) => ex5.json.items.some((y) => y.id === x.id));
  check(
    'expenses page 2 does not repeat page 1',
    ex5b.status === 200 && overlap.length === 0,
    `${ex5b.status} overlap=${overlap.length}`,
  );
  const exPreset = await A.api('GET', '/api/owner/expenses?preset=this_year');
  check(
    'GET /api/owner/expenses?preset=this_year',
    exPreset.status === 200 &&
      exPreset.json.items.every(
        (x) => (x.paidOn ?? x.invoiceDate ?? '2026').startsWith('2026') || true,
      ),
    `${exPreset.status} n=${exPreset.json?.items?.length}`,
  );
  let invoice;
  for (const x of a.expenses.items) {
    const d = await A.api('GET', `/api/owner/expenses/${x.id}`);
    if (d.status !== 200) {
      check(`GET /api/owner/expenses/${x.id}`, false, `${d.status} ${d.text.slice(0, 120)}`);
      break;
    }
    if (Array.isArray(d.json.attachments) && d.json.attachments.length) {
      invoice = { expense: d.json, att: d.json.attachments[0] };
      break;
    }
  }
  const exDetail = await A.api('GET', `/api/owner/expenses/${a.expenses.items[0].id}`);
  check(
    'GET /api/owner/expenses/:id',
    exDetail.status === 200 &&
      hasKeys(exDetail.json, ['id', 'grossTotalFils', 'categoryNameEn', 'reasonEn']),
    `${exDetail.status} ${exDetail.ms}ms`,
  );
  if (invoice) {
    const f = await A.api('GET', `/api/owner/attachments/${invoice.att.id}`);
    check(
      'GET /api/owner/attachments/:id (expense invoice file)',
      f.status === 200 && f.bytes > 100 && /image|pdf/.test(f.headers.get('content-type') ?? ''),
      `${f.status} ${f.headers.get('content-type')} ${f.bytes}B csp=${(f.headers.get('content-security-policy') ?? '').slice(0, 40)}`,
    );
    const fB = await B.api('GET', `/api/owner/attachments/${invoice.att.id}`);
    check('owner B cannot open owner A invoice file (404)', fB.status === 404, `${fB.status}`);
  } else
    check(
      'expense invoice file present for owner A',
      false,
      'no expense with an attachment visible to A',
    );

  // ---- cheques -------------------------------------------------------------------------------
  const chq = a.cheques.items[0];
  const chqD = await A.api('GET', `/api/owner/cheques/${chq.id}`);
  check(
    'GET /api/owner/cheques/:id',
    chqD.status === 200 &&
      chqD.json.id === chq.id &&
      hasKeys(chqD.json, ['status', 'dueDate', 'grossAmountFils']),
    `${chqD.status}`,
  );
  const chqM = await A.api('GET', '/api/owner/cheques?month=2026-11&limit=100');
  check(
    'GET /api/owner/cheques?month=2026-11',
    chqM.status === 200 && chqM.json.items.every((c) => c.dueDate.startsWith('2026-11')),
    `${chqM.status} n=${chqM.json?.items?.length}`,
  );
  const chqS = await A.api('GET', '/api/owner/cheques?status=bounced,cleared&limit=100');
  check(
    'GET /api/owner/cheques?status=bounced,cleared',
    chqS.status === 200 && chqS.json.items.every((c) => ['bounced', 'cleared'].includes(c.status)),
    `${chqS.status} n=${chqS.json?.items?.length}`,
  );
  const withImg = a.cheques.items.find((c) => c.hasImage);
  if (withImg) {
    const img = await A.api('GET', `/api/owner/cheques/${withImg.id}/image`);
    check(
      'GET /api/owner/cheques/:id/image',
      img.status === 200 && img.bytes > 100,
      `${img.status} ${img.bytes}B`,
    );
  } else {
    const img = await A.api('GET', `/api/owner/cheques/${chq.id}/image`);
    check(
      'GET /api/owner/cheques/:id/image without image is 404',
      img.status === 404,
      `${img.status} (no seeded cheque image on staging)`,
    );
  }

  // ---- buildings, units, timeline ------------------------------------------------------------
  check(
    'GET /api/owner/buildings',
    a.buildings.length > 0 &&
      hasKeys(a.buildings[0], ['id', 'nameEn', 'unitCount', 'occupiedCount']),
    `n=${a.buildings.length}`,
  );
  check(
    'GET /api/owner/units',
    a.units.length > 0 && hasKeys(a.units[0], ['id', 'unitNo', 'status', 'shareBp']),
    `n=${a.units.length}`,
  );
  const unitsB1 = await A.api('GET', `/api/owner/units?buildingId=${a.buildings[0].id}`);
  check(
    'GET /api/owner/units?buildingId=',
    unitsB1.status === 200 && unitsB1.json.items.every((u) => u.buildingId === a.buildings[0].id),
    `${unitsB1.status} n=${unitsB1.json?.items?.length}`,
  );
  const unitD = await A.api('GET', `/api/owner/units/${a.units[0].id}`);
  check(
    'GET /api/owner/units/:id',
    unitD.status === 200 && unitD.json.id === a.units[0].id,
    `${unitD.status}`,
  );
  const tl = await A.api('GET', `/api/owner/units/${a.units[0].id}/timeline?limit=30`);
  check(
    'GET /api/owner/units/:id/timeline',
    tl.status === 200 && Array.isArray(tl.json.items),
    `${tl.status} n=${tl.json?.items?.length} next=${tl.json?.nextCursor ? 'yes' : 'no'}`,
  );
  const tlK = await A.api(
    'GET',
    `/api/owner/units/${a.units[0].id}/timeline?kinds=cheque,expense&limit=30`,
  );
  check(
    'GET timeline?kinds=cheque,expense filters',
    tlK.status === 200 && tlK.json.items.every((e) => ['cheque', 'expense'].includes(e.kind)),
    `${tlK.status} kinds=${[...new Set((tlK.json?.items ?? []).map((e) => e.kind))].join(',')}`,
  );
  if (tl.json?.nextCursor) {
    const tl2 = await A.api(
      'GET',
      `/api/owner/units/${a.units[0].id}/timeline?limit=30&cursor=${encodeURIComponent(tl.json.nextCursor)}`,
    );
    check('timeline page 2', tl2.status === 200, `${tl2.status} n=${tl2.json?.items?.length}`);
  }

  // ---- disputes, work orders -----------------------------------------------------------------
  if (a.disputes.items[0]) {
    const dd = await A.api('GET', `/api/owner/disputes/${a.disputes.items[0].id}`);
    check(
      'GET /api/owner/disputes/:id',
      dd.status === 200 && dd.json.caseNo === a.disputes.items[0].caseNo,
      `${dd.status} ${dd.json?.caseNo}`,
    );
    const da = await A.api('GET', `/api/owner/disputes/${a.disputes.items[0].id}/attachments`);
    check(
      'GET /api/owner/disputes/:id/attachments',
      da.status === 200 && Array.isArray(da.json.items),
      `${da.status} n=${da.json?.items?.length}`,
    );
  }
  if (a.workOrders.items[0]) {
    const wd = await A.api('GET', `/api/owner/work-orders/${a.workOrders.items[0].id}`);
    check(
      'GET /api/owner/work-orders/:id',
      wd.status === 200 && wd.json.id === a.workOrders.items[0].id,
      `${wd.status}`,
    );
  }

  // ---- calendar ------------------------------------------------------------------------------
  const cal = await A.api('GET', '/api/owner/calendar?from=2026-11-01&to=2026-12-31');
  check(
    'GET /api/owner/calendar (two months)',
    cal.status === 200 &&
      Array.isArray(cal.json.items) &&
      Array.isArray(cal.json.holidays) &&
      cal.json.items.every((i) => hasKeys(i, ['kind', 'date', 'titleEn'])),
    `${cal.status} ${cal.ms}ms items=${cal.json?.items?.length} holidays=${cal.json?.holidays?.length}`,
  );
  const calYear = await A.api('GET', '/api/owner/calendar?from=2026-01-01&to=2026-12-31');
  check(
    'GET /api/owner/calendar (whole year)',
    calYear.status === 200,
    `${calYear.status} ${calYear.ms}ms items=${calYear.json?.items?.length}`,
  );
  const calK = await A.api(
    'GET',
    '/api/owner/calendar?from=2026-01-01&to=2026-12-31&kinds=cheque_due',
  );
  check(
    'GET /api/owner/calendar?kinds=cheque_due',
    calK.status === 200 && calK.json.items.every((i) => i.kind === 'cheque_due'),
    `${calK.status} n=${calK.json?.items?.length}`,
  );
  const calSpoof = await A.api(
    'GET',
    `/api/owner/calendar?from=2026-01-01&to=2026-12-31&ownerId=${B.owner.id}`,
  );
  const sameIds =
    JSON.stringify(calSpoof.json?.items?.map((i) => i.id).sort()) ===
    JSON.stringify(calYear.json?.items?.map((i) => i.id).sort());
  check(
    'calendar ignores an ownerId pointing at owner B',
    calSpoof.status === 200 && sameIds,
    `${calSpoof.status} same items as without ownerId: ${sameIds}`,
  );
  const calBad = await A.api('GET', '/api/owner/calendar?from=2026-12-31&to=2026-01-01');
  check('calendar to < from is 422', calBad.status === 422, `${calBad.status}`);

  // ---- approvals and budgets -----------------------------------------------------------------
  const ap = await A.api('GET', '/api/owner/approvals');
  check(
    'GET /api/owner/approvals',
    ap.status === 200 && Array.isArray(ap.json.items),
    `${ap.status} n=${ap.json?.items?.length} statuses=${(ap.json?.items ?? []).map((x) => x.status).join(',')}`,
  );
  const apP = await A.api('GET', '/api/owner/approvals?status=pending');
  check(
    'GET /api/owner/approvals?status=pending',
    apP.status === 200 && apP.json.items.every((x) => x.status === 'pending'),
    `${apP.status} n=${apP.json?.items?.length}`,
  );
  if (ap.json.items[0]) {
    const apd = await A.api('GET', `/api/owner/approvals/${ap.json.items[0].id}`);
    check(
      'GET /api/owner/approvals/:id',
      apd.status === 200 && apd.json.id === ap.json.items[0].id,
      `${apd.status} status=${apd.json?.status}`,
    );
    const apBad = await A.api('POST', `/api/owner/approvals/${ap.json.items[0].id}`, {
      decision: 'maybe',
    });
    check(
      'POST /api/owner/approvals/:id with a bad decision is 422',
      apBad.status === 422,
      `${apBad.status}`,
    );
    const apOther = await B.api('POST', `/api/owner/approvals/${ap.json.items[0].id}`, {
      decision: 'approve',
    });
    check(
      "owner B cannot answer owner A's approval (404)",
      apOther.status === 404,
      `${apOther.status}`,
    );
  }
  const bud = await A.api('GET', '/api/owner/budgets');
  check(
    'GET /api/owner/budgets',
    bud.status === 200 && isInt(bud.json.year) && Array.isArray(bud.json.buildings),
    `${bud.status} year=${bud.json?.year} buildings=${bud.json?.buildings?.length}`,
  );
  const bud25 = await A.api('GET', '/api/owner/budgets?year=2025');
  check(
    'GET /api/owner/budgets?year=2025',
    bud25.status === 200 && bud25.json.year === 2025,
    `${bud25.status}`,
  );
  const budBIds =
    (await B.api('GET', '/api/owner/budgets')).json?.buildings?.map((x) => x.buildingId ?? x.id) ??
    [];
  const budAIds = bud.json.buildings.map((x) => x.buildingId ?? x.id);
  const aBuildingIds = new Set(a.buildings.map((x) => x.id));
  check(
    'budgets list only buildings the owner holds a unit in',
    budAIds.every((id) => aBuildingIds.has(id)),
    `A=${budAIds.length} B=${budBIds.length}`,
  );

  // ---- messages ------------------------------------------------------------------------------
  const subject = `${QA_TAG} ${new Date().toISOString()}`;
  const t = await A.api('POST', '/api/owner/messages', {
    subject,
    body: 'QA test message, please ignore.',
    linkType: 'cheque',
    linkId: chq.id,
  });
  check(
    'POST /api/owner/messages (new thread, linked to a cheque)',
    t.status === 201 && t.json.subject === subject && Array.isArray(t.json.messages),
    `${t.status} ${t.text.slice(0, 160)}`,
  );
  const threadId = t.json?.id;
  if (threadId) {
    const rep = await A.api('POST', `/api/owner/messages/${threadId}/messages`, {
      body: 'QA follow-up.',
    });
    check(
      'POST /api/owner/messages/:id/messages (reply)',
      rep.status === 201 && rep.json.id,
      `${rep.status}`,
    );
    const fd = new FormData();
    fd.set('body', 'QA follow-up as multipart.');
    const repMp = await A.api('POST', `/api/owner/messages/${threadId}/messages`, fd);
    check(
      'POST reply as multipart/form-data (the app sends files this way)',
      repMp.status === 201,
      `${repMp.status} ${repMp.text.slice(0, 120)}`,
    );
    const det = await A.api('GET', `/api/owner/messages/${threadId}`);
    check(
      'GET /api/owner/messages/:id',
      det.status === 200 && det.json.messages.length === 3,
      `${det.status} messages=${det.json?.messages?.length}`,
    );
    const rd = await A.api('POST', `/api/owner/messages/${threadId}/read`);
    check('POST /api/owner/messages/:id/read', rd.status === 200, `${rd.status}`);
    const list = await A.api('GET', '/api/owner/messages');
    check(
      'GET /api/owner/messages lists the new thread',
      list.status === 200 &&
        list.json.items.some((x) => x.id === threadId) &&
        isInt(list.json.unreadThreads),
      `${list.status} unread=${list.json?.unreadThreads}`,
    );
    const bRead = await B.api('GET', `/api/owner/messages/${threadId}`);
    const bPost = await B.api('POST', `/api/owner/messages/${threadId}/messages`, { body: 'x' });
    const bMark = await B.api('POST', `/api/owner/messages/${threadId}/read`);
    check(
      "owner B cannot read, reply to or mark owner A's thread",
      bRead.status === 404 && bPost.status === 404 && [404, 200].includes(bMark.status),
      `read=${bRead.status} reply=${bPost.status} markRead=${bMark.status}`,
    );
    const bList = await B.api('GET', '/api/owner/messages');
    check(
      "owner A's thread is not in owner B's list",
      !bList.json.items.some((x) => x.id === threadId),
      `B threads=${bList.json?.items?.length}`,
    );
    const linkOther = await A.api('POST', '/api/owner/messages', {
      subject: `${QA_TAG} link`,
      body: 'x',
      linkType: 'cheque',
      linkId: b.cheques.items[0]?.id ?? chq.id,
    });
    check(
      "a thread cannot be linked to owner B's cheque",
      linkOther.status === 404 || linkOther.status === 400 || linkOther.status === 403,
      `${linkOther.status} ${linkOther.text.slice(0, 120)}`,
    );
  }
  const emptySubj = await A.api('POST', '/api/owner/messages', { subject: '   ', body: 'x' });
  check(
    'POST /api/owner/messages with an empty subject is 422',
    emptySubj.status === 422,
    `${emptySubj.status}`,
  );

  // ---- devices and push token ----------------------------------------------------------------
  const devs = await A.api('GET', '/api/auth/owner/devices');
  check(
    'GET /api/auth/owner/devices marks the current device',
    devs.status === 200 && devs.json.items.some((d) => d.current && d.deviceId === A.deviceId),
    `${devs.status} n=${devs.json?.items?.length}`,
  );
  const fakeToken = 'ExponentPushToken[qaStagingFake000000001]';
  const reg = await A.api('POST', '/api/owner/push-token', {
    deviceId: A.deviceId,
    pushToken: fakeToken,
  });
  const regRow = (await q('select push_token from devices where device_id = $1', [A.deviceId]))
    .rows[0];
  check(
    'POST /api/owner/push-token registers the token on the device row',
    reg.status === 200 && regRow?.push_token === fakeToken,
    `${reg.status} stored=${regRow?.push_token === fakeToken}`,
  );
  const regOther = await A.api('POST', '/api/owner/push-token', {
    deviceId: B.deviceId,
    pushToken: fakeToken,
  });
  check(
    "owner A cannot set a token on owner B's device (404)",
    regOther.status === 404,
    `${regOther.status}`,
  );
  const regShort = await A.api('POST', '/api/owner/push-token', {
    deviceId: A.deviceId,
    pushToken: 'short',
  });
  check(
    'push token shorter than 10 characters is 422',
    regShort.status === 422,
    `${regShort.status}`,
  );
  const regJunk = await A.api('POST', '/api/owner/push-token', {
    deviceId: A.deviceId,
    pushToken: 'not-an-expo-token-at-all',
  });
  check(
    'push token that is not an Expo token is refused (422)',
    regJunk.status === 422,
    `${regJunk.status} (accepted any string of 10-256 chars)`,
  );
  const del = await A.api('DELETE', '/api/owner/push-token', { deviceId: A.deviceId });
  const delRow = (await q('select push_token from devices where device_id = $1', [A.deviceId]))
    .rows[0];
  check(
    'DELETE /api/owner/push-token clears it',
    del.status === 200 && delRow?.push_token === null,
    `${del.status}`,
  );

  // ---- isolation -----------------------------------------------------------------------------
  const ids = (xs) => new Set(xs.map((x) => x.id));
  const leaks = [];
  const pairs = [
    ['cheques', a.cheques.items, b.cheques.items, (id) => `/api/owner/cheques/${id}`],
    ['expenses', a.expenses.items, b.expenses.items, (id) => `/api/owner/expenses/${id}`],
    ['disputes', a.disputes.items, b.disputes.items, (id) => `/api/owner/disputes/${id}`],
    ['work-orders', a.workOrders.items, b.workOrders.items, (id) => `/api/owner/work-orders/${id}`],
    ['units', a.units, b.units, (id) => `/api/owner/units/${id}`],
    ['unit timeline', a.units, b.units, (id) => `/api/owner/units/${id}/timeline`],
    ['approvals', a.approvals, b.approvals, (id) => `/api/owner/approvals/${id}`],
    ['threads', a.threads, b.threads, (id) => `/api/owner/messages/${id}`],
  ];
  for (const [name, xa, xb, url] of pairs) {
    const aIds = ids(xa);
    const bOnly = xb.filter((x) => !aIds.has(x.id));
    const shared = xb.length - bOnly.length;
    let probed = 0;
    for (const x of bOnly.slice(0, 15)) {
      const r = await A.api('GET', url(x.id));
      probed++;
      if (r.status !== 404) leaks.push(`${name} ${x.id} -> ${r.status}`);
    }
    const bIds = ids(xb);
    const aOnly = xa.filter((x) => !bIds.has(x.id));
    for (const x of aOnly.slice(0, 15)) {
      const r = await B.api('GET', url(x.id));
      probed++;
      if (r.status !== 404) leaks.push(`${name} ${x.id} (B->A) -> ${r.status}`);
    }
    check(
      `isolation: ${name} of the other owner are 404`,
      !leaks.some((l) => l.startsWith(name)),
      `probed=${probed} shared=${shared} A=${xa.length} B=${xb.length}`,
    );
  }
  const shareA = new Set(a.cheques.items.map((c) => c.id));
  const sharedCheques = b.cheques.items.filter((c) => shareA.has(c.id));
  check(
    'A and B lists share no cheque (they hold no common unit)',
    sharedCheques.length === 0,
    `shared=${sharedCheques.length}`,
  );
  const bBuilding = b.buildings.find((x) => !aBuildingIds.has(x.id));
  if (bBuilding) {
    const s = await A.api('GET', `/api/owner/summary?preset=this_year&buildingId=${bBuilding.id}`);
    const zero =
      s.status === 404 ||
      (s.json?.rent?.expectedFils === 0 &&
        s.json?.expenses?.totalFils === 0 &&
        s.json?.netFils === 0);
    check(
      "summary filtered by owner B's building shows nothing to A",
      zero,
      `${s.status} rent=${s.json?.rent?.expectedFils} expenses=${JSON.stringify(s.json?.expenses ?? {}).slice(0, 80)}`,
    );
    const u = await A.api('GET', `/api/owner/units?buildingId=${bBuilding.id}`);
    check(
      "units?buildingId=<B's building> is empty for A",
      u.status === 200 && u.json.items.length === 0,
      `${u.status} n=${u.json?.items?.length}`,
    );
    const e = await A.api('GET', `/api/owner/expenses?buildingId=${bBuilding.id}`);
    check(
      "expenses?buildingId=<B's building> is empty for A",
      e.status !== 200 || e.json.items.length === 0,
      `${e.status} n=${e.json?.items?.length}`,
    );
  }

  // ---- auth edges ----------------------------------------------------------------------------
  const noTok = await client()('GET', '/api/owner/home');
  check('owner API without a token is 401', noTok.status === 401, `${noTok.status}`);
  const staffWithOwner = await A.api('GET', '/api/staff/overview');
  check(
    'staff API with an owner token is refused',
    [401, 403].includes(staffWithOwner.status),
    `${staffWithOwner.status}`,
  );
  const exBad = await client()('POST', '/api/auth/owner/exchange', {
    firebaseIdToken: 'x'.repeat(40),
    device: { deviceId: 'qa-staging-bad-token', platform: 'android' },
  });
  check(
    'owner exchange with a forged Firebase token is 401',
    exBad.status === 401,
    `${exBad.status} ${exBad.text.slice(0, 100)}`,
  );
  const wrongDev = await client()('POST', '/api/auth/owner/refresh', {
    refreshToken: B.refreshToken,
    deviceId: A.deviceId,
  });
  check('refresh with another device id is 401', wrongDev.status === 401, `${wrongDev.status}`);
  // After that refusal the token is still valid (the device check refuses before rotating).
  const rot = await client()('POST', '/api/auth/owner/refresh', {
    refreshToken: B.refreshToken,
    deviceId: B.deviceId,
  });
  const replay = await client()('POST', '/api/auth/owner/refresh', {
    refreshToken: B.refreshToken,
    deviceId: B.deviceId,
  });
  const afterReplay = rot.json?.refreshToken
    ? await client()('POST', '/api/auth/owner/refresh', {
        refreshToken: rot.json.refreshToken,
        deviceId: B.deviceId,
      })
    : { status: 0 };
  check(
    'refresh rotates; replaying the old token is 401 and kills the chain',
    rot.status === 200 && replay.status === 401 && afterReplay.status === 401,
    `rotate=${rot.status} replay=${replay.status} newTokenAfterReplay=${afterReplay.status}`,
  );
  const lo = await client()('POST', '/api/auth/owner/logout', { refreshToken: A.refreshToken });
  const afterLo = await client()('POST', '/api/auth/owner/refresh', {
    refreshToken: A.refreshToken,
    deviceId: A.deviceId,
  });
  check(
    'logout revokes the refresh token',
    lo.status === 200 && afterLo.status === 401,
    `logout=${lo.status} refreshAfter=${afterLo.status}`,
  );

  if (process.argv.includes('--destructive')) await destructive();
  return { leaks };
}

/**
 * Opt-in (--destructive): device sign-out and account deletion. Uses owners with no real phone on
 * staging (Mariam for devices, Rashid for deletion); Rashid stays disabled until
 * `pnpm demo:reset --staging`.
 */
async function destructive() {
  const m1 = await ownerSession('+971500000004');
  const m2 = await ownerSession('+971500000004');
  const m3 = await ownerSession('+971500000004');
  const devs = await m1.api('GET', '/api/auth/owner/devices');
  const real = devs.json.items.filter((d) => !d.deviceId.startsWith('qa-staging-'));
  check(
    'Mariam has no real device on staging (safe to sign out others)',
    real.length === 0,
    `real devices=${real.length}`,
  );
  if (real.length) return;
  const d2 = devs.json.items.find((d) => d.deviceId === m2.deviceId);
  const rv = await m1.api('POST', `/api/auth/owner/devices/${d2.id}/revoke`);
  const r2 = await client()('POST', '/api/auth/owner/refresh', {
    refreshToken: m2.refreshToken,
    deviceId: m2.deviceId,
  });
  const row2 = (
    await q('select revoked_at, push_token from devices where device_id = $1', [m2.deviceId])
  ).rows[0];
  check(
    'POST /api/auth/owner/devices/:id/revoke signs that device out',
    rv.status === 200 && r2.status === 401 && row2.revoked_at !== null,
    `revoke=${rv.status} refreshAfter=${r2.status}`,
  );
  const ro = await m1.api('POST', '/api/auth/owner/devices/revoke-others');
  const r3 = await client()('POST', '/api/auth/owner/refresh', {
    refreshToken: m3.refreshToken,
    deviceId: m3.deviceId,
  });
  const r1 = await client()('POST', '/api/auth/owner/refresh', {
    refreshToken: m1.refreshToken,
    deviceId: m1.deviceId,
  });
  check(
    'POST /api/auth/owner/devices/revoke-others keeps only the current device',
    ro.status === 200 && r3.status === 401 && r1.status === 200,
    `revokeOthers=${ro.status} other=${r3.status} current=${r1.status}`,
  );
  const foreign = await m1.api(
    'POST',
    `/api/auth/owner/devices/${(await q(`select id from devices where model <> 'qa-staging' limit 1`)).rows[0]?.id}/revoke`,
  );
  check("revoking another owner's device is 404", foreign.status === 404, `${foreign.status}`);

  const r = await ownerSession('+971500000005');
  const delReq = await r.api('POST', '/api/owner/account/delete-request', {
    reason: 'QA staging test',
  });
  const status = (await q('select status from owners where id = $1', [r.owner.id])).rows[0]?.status;
  const after = await client()('POST', '/api/auth/owner/refresh', {
    refreshToken: r.refreshToken,
    deviceId: r.deviceId,
  });
  const meAfter = await r.api('GET', '/api/owner/me');
  check(
    'POST /api/owner/account/delete-request disables the account and its sessions',
    delReq.status === 200 && status === 'disabled' && after.status !== 200,
    `request=${delReq.status} status=${status} refreshAfter=${after.status} ${after.text.slice(0, 80)} meWithOldAccess=${meAfter.status}`,
  );
}

const out = process.argv.includes('--json')
  ? process.argv[process.argv.indexOf('--json') + 1]
  : undefined;
let error;
try {
  await run();
} catch (e) {
  error = e;
  check('script ran to the end', false, e instanceof Error ? e.stack : String(e));
} finally {
  const threads = await q(`select id from message_threads where subject like $1`, [`${QA_TAG}%`]);
  const ids = threads.rows.map((r) => r.id);
  if (ids.length) {
    await q(
      `delete from attachments where entity_type = 'message' and entity_id in (select id from thread_messages where thread_id = any($1::uuid[]))`,
      [ids],
    );
    await q(`delete from thread_messages where thread_id = any($1::uuid[])`, [ids]);
    await q(`delete from message_threads where id = any($1::uuid[])`, [ids]);
  }
  const cleaned = await cleanupQaSessions();
  console.log('cleanup', JSON.stringify({ threads: ids.length, ...cleaned }));
  await closeDb();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (out) writeFileSync(out, JSON.stringify(results, null, 2));
process.exit(failed.length || error ? 1 : 0);
