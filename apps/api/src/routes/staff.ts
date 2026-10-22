/**
 * Staff API (dashboard). One file per domain under ./staff; every write runs in a transaction
 * with its audit row, and roles are enforced per route (see ./staff/common.ts).
 */
import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
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

export const staffRoutes = new Hono<AppEnv>()
  .route('/', overviewRoutes)
  .route('/', ownersRoutes)
  .route('/', propertiesRoutes)
  .route('/', contractsRoutes)
  .route('/', chequesRoutes)
  .route('/', disputesRoutes)
  .route('/', attachmentsRoutes)
  .route('/', staffUsersRoutes)
  .route('/', importRoutes)
  .route('/', jobsRoutes);
