/**
 * Staff API (dashboard). One file per domain under ./staff; every write runs in a transaction
 * with its audit row, and roles are enforced per route (see ./staff/common.ts).
 */
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env.js';
import { queueBudgetAlerts } from '../services/budget-alerts.js';
import { overviewRoutes } from './staff/overview.js';
import { ownersRoutes } from './staff/owners.js';
import { propertiesRoutes } from './staff/properties.js';
import { contractsRoutes } from './staff/contracts.js';
import { chequesRoutes } from './staff/cheques.js';
import { disputesRoutes } from './staff/disputes.js';
import { attachmentsRoutes } from './staff/attachments.js';
import { staffUsersRoutes } from './staff/staff-users.js';
import { importRoutes } from './staff/import.js';
import { jobsRoutes } from './staff/jobs.js';
import { expensesRoutes } from './staff/expenses.js';
import { workOrdersRoutes } from './staff/work-orders.js';
import { calendarRoutes } from './staff/calendar.js';
import { recordsRoutes } from './staff/records.js';
import { reportsRoutes } from './staff/reports.js';
import { settingsRoutes } from './staff/settings.js';
import { searchRoutes } from './staff/search.js';
import { budgetsRoutes } from './staff/budgets.js';

/**
 * After a staff expense write that went through (post, void with a correction, the bulk actions,
 * showing a hidden expense), the budgets are checked for the 80 % and 100 % pushes in the
 * background. Kept here rather than in each expense route so every way of posting is covered;
 * a write that moves no budget costs a few reads, and the dedupe keys stop any second push.
 */
const budgetAlertsAfterExpenseWrites = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  if (c.req.method === 'POST' && c.res.status < 300)
    c.executionCtx.waitUntil(queueBudgetAlerts(c.env));
});

export const staffRoutes = new Hono<AppEnv>()
  .use('/expenses/*', budgetAlertsAfterExpenseWrites)
  .route('/', overviewRoutes)
  .route('/', ownersRoutes)
  .route('/', propertiesRoutes)
  .route('/', contractsRoutes)
  .route('/', chequesRoutes)
  .route('/', disputesRoutes)
  .route('/', attachmentsRoutes)
  .route('/', staffUsersRoutes)
  .route('/', importRoutes)
  .route('/', jobsRoutes)
  .route('/', expensesRoutes)
  .route('/', workOrdersRoutes)
  .route('/', calendarRoutes)
  .route('/', recordsRoutes)
  .route('/', reportsRoutes)
  .route('/', settingsRoutes)
  .route('/', searchRoutes)
  .route('/', budgetsRoutes);
