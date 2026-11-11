import { describe, expect, it } from 'vitest';
import {
  approvalsBlock,
  approvalState,
  isBlockingApproval,
  needsOwnerApproval,
  silenceCutoff,
  silenceDeadline,
  silenceIsDue,
  type ApprovalLike,
} from './approvals.js';
import { notificationCopy, NOTIFICATION_TYPE_LABEL } from './i18n/notifications.js';
import { APPROVAL_STATE_LABEL, REPAIR_APPROVAL_STATUS_LABEL } from './i18n/labels.js';
import { answerApprovalSchema, updateSettingsSchema, createWorkOrderSchema } from './schemas/v2.js';

const row = (status: ApprovalLike['status'], overridden = false): ApprovalLike => ({
  status,
  overriddenAt: overridden ? new Date('2026-11-01T08:00:00Z') : null,
});

describe('repair approval threshold', () => {
  it('asks at or above the threshold, never without an amount', () => {
    expect(needsOwnerApproval(500_000, 500_000)).toBe(true);
    expect(needsOwnerApproval(499_999, 500_000)).toBe(false);
    expect(needsOwnerApproval(2_000_000, 500_000)).toBe(true);
    expect(needsOwnerApproval(null, 500_000)).toBe(false);
    // A threshold of 0 asks for every job that has an estimate.
    expect(needsOwnerApproval(1, 0)).toBe(true);
    expect(needsOwnerApproval(0, 0)).toBe(false);
  });
});

describe('blocking answers', () => {
  it('pending and rejected block unless overridden; approvals never block', () => {
    expect(isBlockingApproval(row('pending'))).toBe(true);
    expect(isBlockingApproval(row('rejected'))).toBe(true);
    expect(isBlockingApproval(row('approved'))).toBe(false);
    expect(isBlockingApproval(row('approved_by_silence'))).toBe(false);
    expect(isBlockingApproval(row('rejected', true))).toBe(false);
    expect(approvalsBlock([row('approved'), row('pending')])).toBe(true);
    expect(approvalsBlock([row('approved'), row('approved_by_silence')])).toBe(false);
    expect(approvalsBlock([])).toBe(false);
  });

  it('sums a job up in one word', () => {
    expect(approvalState([])).toBe('none');
    expect(approvalState([row('approved'), row('pending')])).toBe('pending');
    expect(approvalState([row('pending'), row('rejected')])).toBe('rejected');
    expect(approvalState([row('approved'), row('approved_by_silence')])).toBe('approved');
    expect(approvalState([row('approved'), row('rejected', true)])).toBe('overridden');
    expect(approvalState([row('pending', true)])).toBe('overridden');
  });
});

describe('silent approval', () => {
  it('counts N days from the day the owner was asked', () => {
    expect(silenceDeadline('2026-11-01', 3)).toBe('2026-11-04');
    expect(silenceIsDue('2026-11-01', 3, '2026-11-03')).toBe(false);
    expect(silenceIsDue('2026-11-01', 3, '2026-11-04')).toBe(true);
    expect(silenceIsDue('2026-11-01', 3, '2026-11-20')).toBe(true);
    expect(silenceCutoff(3, '2026-11-04')).toBe('2026-11-01');
    // Across a month end.
    expect(silenceDeadline('2026-10-30', 3)).toBe('2026-11-02');
  });

  it('0 days turns it off', () => {
    expect(silenceDeadline('2026-11-01', 0)).toBeNull();
    expect(silenceIsDue('2026-11-01', 0, '2027-01-01')).toBe(false);
    expect(silenceCutoff(0, '2026-11-04')).toBeNull();
  });
});

describe('inputs and copy', () => {
  it('validates answers, settings and the estimate', () => {
    expect(answerApprovalSchema.parse({ decision: 'approve' })).toEqual({
      decision: 'approve',
      note: null,
    });
    expect(answerApprovalSchema.safeParse({ decision: 'maybe' }).success).toBe(false);
    expect(
      answerApprovalSchema.safeParse({ decision: 'reject', note: 'x'.repeat(501) }).success,
    ).toBe(false);
    expect(updateSettingsSchema.safeParse({ repairApprovalSilenceDays: 0 }).success).toBe(true);
    expect(updateSettingsSchema.safeParse({ repairApprovalSilenceDays: 61 }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ repairApprovalThresholdFils: -1 }).success).toBe(false);
    const wo = createWorkOrderSchema.parse({
      buildingId: '019a0000-0000-7000-8000-000000000001',
      titleAr: 'تغيير مضخة',
      titleEn: 'Replace pump',
    });
    expect(wo.estimateFils).toBeNull();
    expect(createWorkOrderSchema.safeParse({ ...wo, estimateFils: 12.5 }).success).toBe(false);
  });

  it('push copy in both languages with Western digits', () => {
    const params = {
      type: 'repair_approval_needed' as const,
      title: 'Replace pump',
      placeLabel: 'Al Noor Tower 801',
      totalFils: 1_200_000,
      shareFils: 600_000,
    };
    const en = notificationCopy(params, 'en');
    expect(en.title).toBe('Approval needed');
    expect(en.body).toContain('AED 12,000');
    expect(en.body).toContain('AED 6,000');
    const ar = notificationCopy(
      { ...params, title: 'تغيير مضخة', placeLabel: 'برج النور 801' },
      'ar',
    );
    expect(ar.title).toBe('مطلوب موافقتك');
    expect(ar.body).toMatch(/12,000/);
    expect(ar.body).not.toMatch(/[٠-٩]/);
    expect(NOTIFICATION_TYPE_LABEL.repair_approval_needed.ar).toBe('طلب موافقة');
    expect(REPAIR_APPROVAL_STATUS_LABEL.approved_by_silence.en).toBe('Approved by silence');
    expect(APPROVAL_STATE_LABEL.pending.ar).toBe('بانتظار موافقة الملاك');
  });
});
