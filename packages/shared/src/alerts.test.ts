import { describe, expect, it } from 'vitest';
import {
  chunk,
  dedupeKey,
  selectChequesDueSoon,
  selectContractsEnding,
  selectContractsToExpire,
} from './alerts.js';
import { notificationCopy } from './i18n/notifications.js';

const today = '2026-10-07' as const;

describe('selectChequesDueSoon', () => {
  it('picks upcoming cheques due in exactly 3 days', () => {
    const cheques = [
      { id: 'a', dueDate: '2026-10-10', status: 'upcoming' },
      { id: 'b', dueDate: '2026-10-10', status: 'deposited' },
      { id: 'c', dueDate: '2026-10-09', status: 'upcoming' },
      { id: 'd', dueDate: '2026-10-11', status: 'upcoming' },
    ] as const;
    expect(selectChequesDueSoon(cheques, today).map((c) => c.id)).toEqual(['a']);
  });

  it('crosses month ends', () => {
    expect(
      selectChequesDueSoon([{ id: 'a', dueDate: '2026-11-02', status: 'upcoming' }], '2026-10-30'),
    ).toHaveLength(1);
  });
});

describe('selectContractsEnding', () => {
  it('picks active contracts ending in exactly 60 and 30 days', () => {
    const contracts = [
      { id: 'c60', endDate: '2026-12-06', status: 'active' },
      { id: 'c30', endDate: '2026-11-06', status: 'active' },
      { id: 'c31', endDate: '2026-11-07', status: 'active' },
      { id: 'draft', endDate: '2026-11-06', status: 'draft' },
      { id: 'renewed', endDate: '2026-12-06', status: 'renewed' },
    ] as const;
    const out = selectContractsEnding(contracts, today);
    expect(out.map((e) => [e.contract.id, e.daysLeft, e.type])).toEqual([
      ['c60', 60, 'contract_ending_60'],
      ['c30', 30, 'contract_ending_30'],
    ]);
  });
});

describe('selectContractsToExpire', () => {
  it('expires active contracts that ended before today, not today', () => {
    const contracts = [
      { id: 'yesterday', endDate: '2026-10-06', status: 'active' },
      { id: 'today', endDate: '2026-10-07', status: 'active' },
      { id: 'old-expired', endDate: '2025-01-01', status: 'expired' },
    ] as const;
    expect(selectContractsToExpire(contracts, today).map((c) => c.id)).toEqual(['yesterday']);
  });
});

describe('dedupeKey', () => {
  it('is stable per type, entity and day so a cron re-run cannot double-send', () => {
    expect(dedupeKey('cheque_due_soon', 'abc', today)).toBe('cheque_due_soon:abc:2026-10-07');
    expect(dedupeKey('cheque_due_soon', 'abc', today)).toBe(
      dedupeKey('cheque_due_soon', 'abc', today),
    );
    expect(dedupeKey('cheque_due_soon', 'abc', '2026-10-08')).not.toBe(
      dedupeKey('cheque_due_soon', 'abc', today),
    );
  });
});

describe('chunk', () => {
  it('splits into Expo-sized batches', () => {
    const items = Array.from({ length: 250 }, (_, i) => i);
    const batches = chunk(items, 100);
    expect(batches.map((b) => b.length)).toEqual([100, 100, 50]);
    expect(chunk([], 100)).toEqual([]);
    expect(() => chunk(items, 0)).toThrow(RangeError);
  });
});

describe('notificationCopy', () => {
  it('uses Western digits and the owner language', () => {
    const ar = notificationCopy(
      {
        type: 'cheque_due_soon',
        amountFils: 2_500_000,
        dueDate: '2026-10-10',
        unitLabel: 'برج النور 1204',
      },
      'ar',
    );
    expect(ar.title).toBe('شيك مستحق بعد 3 أيام');
    expect(ar.body).toContain('25,000 درهم');
    expect(ar.body).toContain('10 أكتوبر 2026');
    expect(/[٠-٩]/.test(ar.body)).toBe(false);

    const en = notificationCopy(
      {
        type: 'cheque_due_soon',
        amountFils: 2_500_000,
        dueDate: '2026-10-10',
        unitLabel: 'Al Noor Tower 1204',
      },
      'en',
    );
    expect(en.body).toBe('A cheque of AED 25,000 for Al Noor Tower 1204 is due on 10 Oct 2026.');
  });

  it('covers every type', () => {
    expect(
      notificationCopy({ type: 'cheque_bounced', amountFils: 100, unitLabel: 'X' }, 'en').title,
    ).toBe('Cheque bounced');
    expect(
      notificationCopy({ type: 'contract_ending_60', unitLabel: 'X', endDate: '2026-12-06' }, 'en')
        .title,
    ).toBe('Contract ends in 60 days');
    expect(
      notificationCopy({ type: 'contract_ending_30', unitLabel: 'X', endDate: '2026-11-06' }, 'ar')
        .title,
    ).toBe('عقد ينتهي بعد 30 يوماً');
    expect(
      notificationCopy({ type: 'new_device_login', deviceLabel: 'iPhone 15' }, 'en').body,
    ).toContain('iPhone 15');
  });
});
