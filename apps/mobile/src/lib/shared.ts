/**
 * The app's door to @vamar/shared. The package's own index also re-exports every zod schema
 * (and zod itself, about 320 KB of the phone's bundle, all of it built when the app starts);
 * Metro does not tree-shake, so the app imports the rule modules it uses directly and never the
 * package index. Types may still come from the package: they vanish when the app is built.
 * src/__tests__/shared-imports.test.ts keeps every other file going through here.
 */
export * from '../../../../packages/shared/src/dates';
export * from '../../../../packages/shared/src/money';
export * from '../../../../packages/shared/src/cheques';
export * from '../../../../packages/shared/src/shares';
export * from '../../../../packages/shared/src/occupancy';
export * from '../../../../packages/shared/src/periods';
export * from '../../../../packages/shared/src/expenses';
export * from '../../../../packages/shared/src/calendar';
export * from '../../../../packages/shared/src/approvals';
export * from '../../../../packages/shared/src/budgets';
export * from '../../../../packages/shared/src/owner-messages';
export * from '../../../../packages/shared/src/i18n/labels';
export type {
  DisputeStatus,
  DisputeType,
  OwnerVisibleSettings,
  TimelineKind,
  UnitType,
} from '@vamar/shared';
