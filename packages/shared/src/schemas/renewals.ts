import { z } from 'zod';
import { filsSchema } from './common.js';

/** Optional body of POST /contracts/:id/renew: the new annual rent, else the old one is kept. */
export const renewContractSchema = z.object({ annualRentFils: filsSchema.optional() });
export type RenewContractInput = z.infer<typeof renewContractSchema>;
