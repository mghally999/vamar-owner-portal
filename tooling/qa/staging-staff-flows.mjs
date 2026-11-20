#!/usr/bin/env node
/**
 * Staff flows and push notifications against STAGING through the real API.
 *
 *   node tooling/qa/staging-staff-flows.mjs [--json out.json]
 *
 * Owner used for every push: Mariam Al Qasimi (+971500000004, 100 % of Al Khan Residence), who
 * has no real phone on staging. Her pushes go to QA devices carrying fake Expo tokens:
 *   - a syntactically valid token (ExponentPushToken[...]) that Expo does not know, and
 *   - a junk string the API accepts (no format check), to see what one bad token does to a batch.
 *
 * Real phones are never pushed to: every non-QA device token on staging is put aside before the
 * first write and put back at the end (a staff expense write runs the budget check for every
 * building, and the daily job alerts every owner). A copy is kept in the OS temp folder in case
 * the script is killed half way: run with --restore-tokens to put it back.
 *
 * Writes on staging: one work order and its approval, one message thread with replies, one posted
 * expense, notification_log rows, two daily-job runs. Run `pnpm demo:reset --staging` afterwards.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  QA_MODEL,
  QA_TAG,
  assertStaging,
  cleanupQaSessions,
  closeDb,
  ownerSession,
  q,
  recorder,
  staffSession,
} from './staging-lib.mjs';

const STASH = join(tmpdir(), 'vamar-qa-staging-push-tokens.json');
const MARIAM = '+971500000004';
const { results, check } = recorder();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fakeExpoToken = () => `ExponentPushToken[qaStg${randomBytes(8).toString('hex')}]`;
const JUNK_TOKEN = 'qa-staging-not-an-expo-token';

async function stashRealTokens() {
  const { rows } = await q(
    `select id, push_token from devices where push_token is not null and model <> $1`,
    [QA_MODEL],
  );
  if (existsSync(STASH)) {
    // An earlier run died before restoring: keep its copy, it holds the real values.
    const prev = JSON.parse(readFileSync(STASH, 'utf8'));
    for (const r of rows) if (!prev.some((p) => p.id === r.id)) prev.push(r);
    writeFileSync(STASH, JSON.stringify(prev));
  } else writeFileSync(STASH, JSON.stringify(rows));
  if (rows.length)
    await q(`update devices set push_token = null where id = any($1::uuid[])`, [
      rows.map((r) => r.id),
    ]);
  return rows.length;
}
async function restoreRealTokens() {
  if (!existsSync(STASH)) return 0;
  const rows = JSON.parse(readFileSync(STASH, 'utf8'));
  for (const r of rows)
    await q(`update devices set push_token = $2 where id = $1`, [r.id, r.push_token]);
  rmSync(STASH);
  return rows.length;
}

/** Waits for a notification_log row (waitUntil work runs after the response). */
async function waitForLog(where, params, { timeoutMs = 30_000, settled = true } = {}) {
  const t0 = Date.now();
  let rows = [];
  while (Date.now() - t0 < timeoutMs) {
    rows = (
      await q(
        `select type, result, dedupe_key, sent_at, entity_id from notification_log where ${where}`,
        params,
      )
    ).rows;
    if (rows.length && (!settled || rows.every((r) => r.result !== 'queued'))) return rows;
    await sleep(1500);
  }
  return rows;
}
async function setDeviceToken(deviceId, token) {
  await q(`update devices set push_token = $2 where device_id = $1`, [deviceId, token]);
}
async function deviceToken(deviceId) {
  return (await q(`select push_token from devices where device_id = $1`, [deviceId])).rows[0]
    ?.push_token;
}

async function run() {
  await assertStaging();
  const stashed = await stashRealTokens();
  check(
    'real device push tokens put aside for the run',
    true,
    `${stashed} real token(s) set aside`,
  );

  // ---- staff sign-in -------------------------------------------------------------------------
  const admin = await staffSession('admin@vamar.test');
  const entry = await staffSession('entry@vamar.test');
  const meA = await admin.api('GET', '/api/auth/staff/me');
  const meE = await entry.api('GET', '/api/auth/staff/me');
  check(
    'staff session admin via real /api/auth/staff/refresh (cookie)',
    meA.status === 200 && meA.json.role === 'admin',
    `${meA.status} role=${meA.json?.role}`,
  );
  check(
    'staff session entry (editor) via real /api/auth/staff/refresh',
    meE.status === 200 && meE.json.role === 'editor',
    `${meE.status} role=${meE.json?.role}`,
  );
  const settings = (await admin.api('GET', '/api/staff/settings')).json;
  check(
    'GET /api/staff/settings',
    settings && Number.isInteger(settings.repairApprovalThresholdFils),
    `threshold=${settings?.repairApprovalThresholdFils} largeExpense=${settings?.largeExpenseAlertFils}`,
  );
  const jobsAsEntry = await entry.api('POST', '/api/staff/jobs/daily');
  check(
    'POST /api/staff/jobs/daily as editor is 403',
    jobsAsEntry.status === 403,
    `${jobsAsEntry.status}`,
  );

  // ---- owner Mariam with a fake but valid-looking Expo token ---------------------------------
  const tokenA = fakeExpoToken();
  const M = await ownerSession(MARIAM, { pushToken: tokenA });
  const { rows: unitRows } = await q(
    `select u.id, u.unit_no, u.building_id from unit_ownerships uo join units u on u.id = uo.unit_id
      where uo.owner_id = $1 and uo.to_date is null order by u.unit_no limit 1`,
    [M.owner.id],
  );
  const unit = unitRows[0];
  check(
    'Mariam signed in with a QA device holding a fake Expo token',
    Boolean(unit),
    `unit ${unit?.unit_no}`,
  );

  // ---- 1. work order needing approval -> approval push -> owner answers -----------------------
  const estimate = settings.repairApprovalThresholdFils + 100_000;
  const wo = await entry.api('POST', '/api/staff/work-orders', {
    buildingId: unit.building_id,
    unitId: unit.id,
    titleAr: `${QA_TAG} تسرب مياه`,
    titleEn: `${QA_TAG} Water leak`,
    description: 'QA test work order, please ignore.',
    estimateFils: estimate,
  });
  check(
    'POST /api/staff/work-orders with an estimate over the threshold',
    wo.status === 201 && wo.json.id,
    `${wo.status} ${wo.text.slice(0, 160)}`,
  );
  const woId = wo.json?.id;
  const appr = (
    await q(`select id, status, owner_id from repair_approvals where work_order_id = $1`, [woId])
  ).rows;
  check(
    'the work order asked its owner (repair_approvals row, pending)',
    appr.length === 1 && appr[0].status === 'pending' && appr[0].owner_id === M.owner.id,
    JSON.stringify(appr.map((a) => a.status)),
  );
  const apprLog = await waitForLog(
    `owner_id = $1 and type = 'repair_approval_needed' and entity_id = $2`,
    [M.owner.id, appr[0]?.id],
  );
  check(
    'push: repair_approval_needed logged for the owner and sent to Expo',
    apprLog.length === 1 && apprLog[0].result !== 'queued' && apprLog[0].result !== 'no_device',
    `result=${apprLog[0]?.result}`,
  );
  const tokAfterApproval = await deviceToken(M.deviceId);
  check(
    'push: Expo DeviceNotRegistered clears the device token',
    apprLog[0]?.result !== 'error:DeviceNotRegistered' || tokAfterApproval === null,
    `result=${apprLog[0]?.result} tokenNow=${tokAfterApproval === null ? 'null' : 'kept'}`,
  );

  const mList = await M.api('GET', '/api/owner/approvals?status=pending');
  check(
    'owner sees the approval request',
    mList.status === 200 && mList.json.items.some((x) => x.id === appr[0]?.id),
    `${mList.status} n=${mList.json?.items?.length}`,
  );
  const woBlocked = await entry.api('PATCH', `/api/staff/work-orders/${woId}`, {
    status: 'in_progress',
  });
  check(
    'work order cannot start while the answer is pending',
    woBlocked.status === 409,
    `${woBlocked.status} ${woBlocked.text.slice(0, 120)}`,
  );
  const ans = await M.api('POST', `/api/owner/approvals/${appr[0]?.id}`, {
    decision: 'approve',
    note: 'QA approve',
  });
  check(
    'owner answers the approval (approve)',
    ans.status === 200 && ans.json.status === 'approved',
    `${ans.status} status=${ans.json?.status}`,
  );
  const ans2 = await M.api('POST', `/api/owner/approvals/${appr[0]?.id}`, { decision: 'reject' });
  check(
    'answering twice is refused',
    ans2.status >= 400 && ans2.status < 500,
    `${ans2.status} ${ans2.text.slice(0, 100)}`,
  );
  const woDet = await admin.api('GET', `/api/staff/work-orders/${woId}`);
  check(
    'staff see the owner answer on the work order',
    woDet.status === 200 && woDet.json.approvals?.items?.[0]?.status === 'approved',
    `${woDet.status} ${JSON.stringify(woDet.json?.approvals).slice(0, 160)}`,
  );
  const woStart = await entry.api('PATCH', `/api/staff/work-orders/${woId}`, {
    status: 'in_progress',
  });
  check('work order can start after approval', woStart.status === 200, `${woStart.status}`);

  // ---- 2. message reply push, valid-looking token + junk token in one Expo request ------------
  await setDeviceToken(M.deviceId, tokenA);
  const M2 = await ownerSession(MARIAM, { pushToken: JUNK_TOKEN });
  const th = await M.api('POST', '/api/owner/messages', {
    subject: `${QA_TAG} push`,
    body: 'QA: please ignore.',
  });
  check('owner opens a thread', th.status === 201, `${th.status}`);
  const inbox = await entry.api('GET', '/api/staff/messages?waiting=1');
  check(
    'staff inbox lists the waiting thread',
    inbox.status === 200 && inbox.json.items.some((x) => x.id === th.json?.id),
    `${inbox.status}`,
  );
  const rep = await entry.api('POST', `/api/staff/messages/${th.json?.id}/messages`, {
    body: 'QA staff reply.',
  });
  check('POST /api/staff/messages/:id/messages (staff reply)', rep.status === 201, `${rep.status}`);
  const repLog = await waitForLog(`owner_id = $1 and type = 'message_reply' and entity_id = $2`, [
    M.owner.id,
    rep.json?.id,
  ]);
  const tokA2 = await deviceToken(M.deviceId);
  const tokJ = await deviceToken(M2.deviceId);
  check(
    'push: message_reply logged and sent to Expo',
    repLog.length === 1 && !['queued', 'no_device'].includes(repLog[0].result),
    `result=${repLog[0]?.result}`,
  );
  check(
    'push: one junk token does not fail the whole Expo request',
    !String(repLog[0]?.result).startsWith('failed:'),
    `result=${repLog[0]?.result} validLookingToken=${tokA2 === null ? 'cleared' : 'kept'} junkToken=${tokJ === null ? 'cleared' : 'kept'}`,
  );
  check(
    'push: the junk token is cleared or never stored',
    tokJ === null,
    `junkToken=${tokJ === null ? 'cleared' : 'still on the device'}`,
  );
  const thO = await M.api('GET', `/api/owner/messages/${th.json?.id}`);
  check(
    'owner reads the staff reply',
    thO.status === 200 && thO.json.messages.some((m) => m.senderType === 'staff'),
    `${thO.status}`,
  );
  // Junk token off again so later checks measure one thing at a time.
  await setDeviceToken(M2.deviceId, null);

  // ---- 3. expense that crosses a budget threshold -> budget + large-expense pushes ------------
  await setDeviceToken(M.deviceId, fakeExpoToken());
  const budgets = (await admin.api('GET', '/api/staff/budgets?year=2026')).json;
  const bLines = budgets.buildings.find((b) => b.buildingId === unit.building_id)?.lines ?? [];
  const line = bLines.find((l) => l.categoryId && l.level === 'ok');
  check(
    'a budget line under 80 % exists on the owner building',
    Boolean(line),
    line ? `${line.nameEn} ${line.percent}%` : 'none',
  );
  const need = Math.max(
    Math.ceil(line.budgetFils * 0.8) - line.actualFils + 1000,
    settings.largeExpenseAlertFils,
  );
  const today = budgets.today;
  const x = await entry.api('POST', '/api/staff/expenses', {
    scope: 'building',
    buildingId: unit.building_id,
    categoryId: line.categoryId,
    reasonAr: `${QA_TAG} مصروف اختبار`,
    reasonEn: `${QA_TAG} test expense`,
    invoiceDate: today,
    amountFils: need,
    vatFils: 0,
    visibleToOwner: true,
  });
  check(
    'POST /api/staff/expenses (draft)',
    x.status === 201,
    `${x.status} ${x.text.slice(0, 160)}`,
  );
  const xApprovals = (
    await q(`select id, status from repair_approvals where expense_id = $1`, [x.json?.id])
  ).rows;
  if (xApprovals.length) {
    for (const a of xApprovals)
      await M.api('POST', `/api/owner/approvals/${a.id}`, { decision: 'approve' });
  }
  const post = await entry.api('POST', `/api/staff/expenses/${x.json?.id}/post`);
  check(
    'POST /api/staff/expenses/:id/post',
    post.status === 200,
    `${post.status} large=${post.json?.large} approvalsAsked=${xApprovals.length}`,
  );
  const budLog = await waitForLog(`owner_id = $1 and type = 'budget_threshold'`, [M.owner.id]);
  check(
    'push: budget_threshold logged for the owner',
    budLog.length >= 1 && !budLog.some((r) => r.result === 'queued'),
    budLog.map((r) => `${r.dedupe_key.split(':').slice(-2).join(':')}=${r.result}`).join(' ') ||
      'none',
  );
  const largeLog = await waitForLog(`owner_id = $1 and type = 'large_expense' and entity_id = $2`, [
    M.owner.id,
    x.json?.id,
  ]);
  check(
    'push: large_expense logged for the owner',
    largeLog.length === 1 && largeLog[0].result !== 'queued',
    `result=${largeLog[0]?.result}`,
  );
  const after = (await admin.api('GET', '/api/staff/budgets?year=2026')).json.buildings
    .find((b) => b.buildingId === unit.building_id)
    .lines.find((l) => l.budgetId === line.budgetId);
  check(
    'budget line now at or over 80 %',
    after.percent >= 80,
    `${after.percent}% level=${after.level}`,
  );
  const ownerBud = await M.api('GET', '/api/owner/budgets');
  const ownerLine = ownerBud.json.buildings?.[0]?.lines?.find((l) => l.budgetId === line.budgetId);
  check(
    'owner budget card shows the same line',
    ownerBud.status === 200 && ownerLine?.percent === after.percent,
    `${ownerBud.status} owner=${ownerLine?.percent}% staff=${after.percent}%`,
  );
  const othersBudget = (
    await q(
      `select o.phone_e164, n.result, n.dedupe_key from notification_log n join owners o on o.id = n.owner_id where n.type = 'budget_threshold' and n.owner_id <> $1`,
      [M.owner.id],
    )
  ).rows;
  check(
    'budget check ran for every building (other owners logged with no device)',
    othersBudget.every((r) => r.result === 'no_device'),
    othersBudget.map((r) => `${r.phone_e164}:${r.result}`).join(' ') || 'none',
  );

  // ---- 4. daily job (staging has no cron) -----------------------------------------------------
  // The seed has no cheque due in exactly 3 days today, so one of Mariam's upcoming cheques is
  // moved there through the staff API (and moved back afterwards) to make the job send something.
  await setDeviceToken(M.deviceId, fakeExpoToken());
  const plus3 = new Date(`${today}T00:00:00Z`);
  plus3.setUTCDate(plus3.getUTCDate() + 3);
  const dueTarget = plus3.toISOString().slice(0, 10);
  const { rows: chqRows } = await q(
    `select c.id, c.due_date::text as due from cheques c
       join contracts k on k.id = c.contract_id
       join unit_ownerships uo on uo.unit_id = k.unit_id and uo.owner_id = $1 and uo.to_date is null
      where c.status = 'upcoming' and k.status = 'active' and c.amount_fils is not null
      order by c.due_date limit 1`,
    [M.owner.id],
  );
  const movedCheque = chqRows[0];
  if (movedCheque) {
    const mv = await entry.api('PATCH', `/api/staff/cheques/${movedCheque.id}`, {
      dueDate: dueTarget,
    });
    check(
      `PATCH /api/staff/cheques/:id due date to ${dueTarget} (to make a reminder due)`,
      mv.status === 200,
      `${mv.status} was ${movedCheque.due}`,
    );
  }
  const before = Number((await q(`select count(*) from notification_log`)).rows[0].count);
  const d1 = await admin.api('POST', '/api/staff/jobs/daily');
  check(
    'POST /api/staff/jobs/daily as admin',
    d1.status === 200 && Array.isArray(d1.json?.errors) && d1.json.errors.length === 0,
    `${d1.status} ${d1.ms}ms ${d1.text.slice(0, 300)}`,
  );
  const afterD1 = (
    await q(
      `select type, result, count(*)::int n from notification_log group by 1, 2 order by 1, 2`,
    )
  ).rows;
  const nAfter = afterD1.reduce((s, r) => s + r.n, 0);
  check(
    'daily job wrote notification rows',
    nAfter > before,
    `${before} -> ${nAfter}: ${afterD1.map((r) => `${r.type}/${r.result}=${r.n}`).join(' ')}`,
  );
  const mDaily = (
    await q(
      `select type, result from notification_log where owner_id = $1 and sent_at > now() - interval '5 minutes' and type in ('cheque_due_soon','contract_ending_60','contract_ending_30','hearing_soon','monthly_summary')`,
      [M.owner.id],
    )
  ).rows;
  check(
    'daily job alerts for the QA owner reached Expo (not no_device)',
    mDaily.length === 0 || mDaily.every((r) => r.result !== 'no_device' && r.result !== 'queued'),
    mDaily.map((r) => `${r.type}=${r.result}`).join(' ') || 'no daily alert due for Mariam today',
  );
  const snapshot = (await q(`select dedupe_key, sent_at, result from notification_log`)).rows;
  const d2 = await admin.api('POST', '/api/staff/jobs/daily');
  const snapshot2 = (await q(`select dedupe_key, sent_at, result from notification_log`)).rows;
  const reclaimed = snapshot2.filter((r) => {
    const o = snapshot.find((s) => s.dedupe_key === r.dedupe_key);
    return o && new Date(o.sent_at).getTime() !== new Date(r.sent_at).getTime();
  });
  check(
    'second daily run sends nothing again (dedupe)',
    d2.status === 200 && d2.json.sent === 0 && snapshot2.length === snapshot.length,
    `${d2.status} sent=${d2.json?.sent} skipped=${d2.json?.skipped} failed=${d2.json?.failed} rows ${snapshot.length}->${snapshot2.length}`,
  );
  check(
    'no retry storm: only failed:* rows are claimed again',
    reclaimed.every((r) => String(r.result).startsWith('failed:') || r.result === 'queued'),
    `reclaimed=${reclaimed.length} (${[...new Set(reclaimed.map((r) => r.result))].join(',')})`,
  );
  const failed = snapshot2.filter((r) => String(r.result).startsWith('failed:'));
  check(
    'no transport failures towards Expo',
    failed.length === 0,
    `failed rows=${failed.length} ${[...new Set(failed.map((r) => r.result))].join(',')}`,
  );
  if (movedCheque) {
    const due = (
      await q(
        `select result from notification_log where type = 'cheque_due_soon' and entity_id = $1 and owner_id = $2`,
        [movedCheque.id, M.owner.id],
      )
    ).rows;
    check(
      'push: daily job cheque_due_soon for the moved cheque sent to Expo',
      due.length === 1 && (due[0].result === 'ok' || due[0].result.startsWith('error:')),
      `result=${due[0]?.result} dueReminders=${d1.json?.dueReminders}`,
    );
    const back = await entry.api('PATCH', `/api/staff/cheques/${movedCheque.id}`, {
      dueDate: movedCheque.due,
    });
    check('cheque due date put back', back.status === 200, `${back.status} -> ${movedCheque.due}`);
  }

  return { woId };
}

if (process.argv.includes('--restore-tokens')) {
  console.log('restored', await restoreRealTokens());
  await closeDb();
  process.exit(0);
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
  const cleaned = await cleanupQaSessions();
  const restored = await restoreRealTokens();
  const log = (
    await q(
      `select type, result, count(*)::int n from notification_log group by 1, 2 order by 1, 2`,
    )
  ).rows;
  console.log('notification_log now:', log.map((r) => `${r.type}/${r.result}=${r.n}`).join(' '));
  console.log('cleanup', JSON.stringify({ ...cleaned, realTokensRestored: restored }));
  await closeDb();
}
const failedChecks = results.filter((r) => !r.ok);
console.log(`\n${results.length - failedChecks.length}/${results.length} checks passed`);
if (out) writeFileSync(out, JSON.stringify(results, null, 2));
process.exit(failedChecks.length || error ? 1 : 0);
