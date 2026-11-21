/**
 * Every rule module of the package without the zod schemas (`@vamar/shared/rules`). Nothing
 * reachable from here imports zod at run time (rules.test.ts checks it), so the owner app and
 * other bundles that do not validate input stay free of zod. `@vamar/shared` is this plus the
 * schemas; single modules are also importable, e.g. `@vamar/shared/dates`.
 */
export * from './dates.js';
export * from './money.js';
export * from './phone.js';
export * from './schedule.js';
export * from './cheques.js';
export * from './bank-statement.js';
export * from './shares.js';
export * from './occupancy.js';
export * from './alerts.js';
export * from './periods.js';
export * from './expenses.js';
export * from './rent.js';
export * from './calendar.js';
export * from './settings.js';
export * from './approvals.js';
export * from './renewals.js';
export * from './budgets.js';
export * from './owner-messages.js';
export * from './i18n/notifications.js';
export * from './i18n/labels.js';
