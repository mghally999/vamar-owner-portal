/** Input schemas for building budgets (v3): the admin's writes and the year both apps ask for. */
import { z } from 'zod';
import { MAX_BUDGET_YEAR, MIN_BUDGET_YEAR } from '../budgets.js';
import { filsSchema, uuidSchema } from './common.js';

export const budgetYearSchema = z.coerce.number().int().min(MIN_BUDGET_YEAR).max(MAX_BUDGET_YEAR);

export const createBudgetSchema = z.object({
  buildingId: uuidSchema,
  year: z.number().int().min(MIN_BUDGET_YEAR).max(MAX_BUDGET_YEAR),
  /** null: the building's total for the year. */
  categoryId: uuidSchema.nullable().default(null),
  amountFils: filsSchema,
});
export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;

/** Only the amount changes; another building, year or category is another budget. */
export const updateBudgetSchema = z.object({ amountFils: filsSchema });

/** Staff: one building or all of them; the year defaults to the current Dubai year. */
export const budgetQuerySchema = z.object({
  year: budgetYearSchema.optional(),
  buildingId: uuidSchema.optional(),
});

export const ownerBudgetQuerySchema = z.object({ year: budgetYearSchema.optional() });
