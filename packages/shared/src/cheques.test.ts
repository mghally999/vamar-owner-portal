import { describe, expect, it } from 'vitest';
import {
  CHEQUE_STATUSES,
  InvalidChequeTransitionError,
  canTransitionCheque,
  isChequeStatus,
  isTerminalChequeStatus,
  planBulkTransition,
  transitionCheque,
  type ChequeStatus,
} from './cheques.js';

const ALLOWED: [ChequeStatus, ChequeStatus][] = [
  ['upcoming', 'deposited'],
  ['upcoming', 'cancelled'],
  ['deposited', 'cleared'],
  ['deposited', 'bounced'],
  ['bounced', 'deposited'],
  ['bounced', 'replaced'],
];

describe('cheque state machine', () => {
  it('allows exactly the documented transitions and forbids every other pair', () => {
    for (const from of CHEQUE_STATUSES) {
      for (const to of CHEQUE_STATUSES) {
        const expected = ALLOWED.some(([f, t]) => f === from && t === to);
        expect(canTransitionCheque(from, to), `${from} -> ${to}`).toBe(expected);
        if (expected) {
          expect(transitionCheque(from, to).to).toBe(to);
        } else {
          expect(() => transitionCheque(from, to)).toThrow(InvalidChequeTransitionError);
        }
      }
    }
  });

  it('knows terminal statuses', () => {
    expect(isTerminalChequeStatus('cleared')).toBe(true);
    expect(isTerminalChequeStatus('replaced')).toBe(true);
    expect(isTerminalChequeStatus('cancelled')).toBe(true);
    expect(isTerminalChequeStatus('upcoming')).toBe(false);
    expect(isTerminalChequeStatus('deposited')).toBe(false);
    expect(isTerminalChequeStatus('bounced')).toBe(false);
  });

  it('type guard', () => {
    expect(isChequeStatus('bounced')).toBe(true);
    expect(isChequeStatus('paid')).toBe(false);
    expect(isChequeStatus(1)).toBe(false);
  });
});

describe('transition effects', () => {
  it('replaced requires a replacement cheque', () => {
    expect(transitionCheque('bounced', 'replaced').requiresReplacementCheque).toBe(true);
    expect(transitionCheque('bounced', 'deposited').requiresReplacementCheque).toBe(false);
  });

  it('bounced notifies owners and stamps bounced_at', () => {
    const e = transitionCheque('deposited', 'bounced');
    expect(e.notifyOwners).toBe(true);
    expect(e.stamp).toBe('bounced_at');
  });

  it('stamps deposited_at and cleared_at', () => {
    expect(transitionCheque('upcoming', 'deposited').stamp).toBe('deposited_at');
    expect(transitionCheque('bounced', 'deposited').stamp).toBe('deposited_at');
    expect(transitionCheque('deposited', 'cleared').stamp).toBe('cleared_at');
    expect(transitionCheque('upcoming', 'cancelled').stamp).toBeNull();
    expect(transitionCheque('upcoming', 'cancelled').notifyOwners).toBe(false);
  });
});

describe('admin override of terminal statuses', () => {
  it('allows correcting a terminal status with a reason', () => {
    const e = transitionCheque('cleared', 'deposited', {
      adminOverride: { reason: 'Bank reversed the clearance' },
    });
    expect(e.overrideReason).toBe('Bank reversed the clearance');
    expect(e.stamp).toBe('deposited_at');
  });

  it('refuses without a reason, with a blank reason, or from a non-terminal status', () => {
    expect(() => transitionCheque('cleared', 'deposited')).toThrow(InvalidChequeTransitionError);
    expect(() =>
      transitionCheque('cleared', 'deposited', { adminOverride: { reason: '   ' } }),
    ).toThrow(InvalidChequeTransitionError);
    // upcoming -> cleared is illegal and upcoming is not terminal: override does not apply
    expect(() =>
      transitionCheque('upcoming', 'cleared', { adminOverride: { reason: 'x' } }),
    ).toThrow(InvalidChequeTransitionError);
  });

  it('never allows a no-op transition', () => {
    expect(() =>
      transitionCheque('cleared', 'cleared', { adminOverride: { reason: 'x' } }),
    ).toThrow();
  });

  it('a normal transition carries no override reason even if one is passed', () => {
    expect(
      transitionCheque('upcoming', 'deposited', { adminOverride: { reason: 'x' } }).overrideReason,
    ).toBeNull();
  });
});

describe('planBulkTransition', () => {
  it('judges each cheque on its own and reports partial failures', () => {
    const r = planBulkTransition(
      [
        { id: 'a', from: 'upcoming' },
        { id: 'b', from: 'cleared' },
        { id: 'c', from: 'bounced' },
      ],
      'deposited',
    );
    expect(r.ok.map((x) => x.id)).toEqual(['a', 'c']);
    expect(r.failed).toEqual([
      { id: 'b', from: 'cleared', reason: 'Cannot move a cheque from cleared to deposited' },
    ]);
  });
});
