/** Input schemas for owner messages (v3): what the app and the dashboard send. */
import { z } from 'zod';
import {
  MAX_MESSAGE_LENGTH,
  MAX_THREAD_SUBJECT_LENGTH,
  MESSAGE_LINK_TYPES,
  MESSAGE_THREAD_STATUSES,
  normalizeMessageText,
  normalizeSubject,
  textLength,
} from '../owner-messages.js';
import { paginationQuerySchema, uuidSchema } from './common.js';

export const messageThreadStatusSchema = z.enum(MESSAGE_THREAD_STATUSES);
export const messageLinkTypeSchema = z.enum(MESSAGE_LINK_TYPES);

/**
 * The text of a message after clean-up. It may be empty here: a message with a file needs no
 * text, and the API refuses one with neither.
 */
export const messageTextSchema = z
  .string()
  .transform(normalizeMessageText)
  .refine((s) => textLength(s) <= MAX_MESSAGE_LENGTH, {
    message: `At most ${String(MAX_MESSAGE_LENGTH)} characters · ${String(MAX_MESSAGE_LENGTH)} حرف كحد أقصى`,
  });

export const threadSubjectSchema = z
  .string()
  .transform(normalizeSubject)
  .refine((s) => s.length > 0, { message: 'A subject is required · الموضوع مطلوب' })
  .refine((s) => textLength(s) <= MAX_THREAD_SUBJECT_LENGTH, {
    message: `At most ${String(MAX_THREAD_SUBJECT_LENGTH)} characters · ${String(MAX_THREAD_SUBJECT_LENGTH)} حرف كحد أقصى`,
  });

/** An owner's new thread; `linkType` and `linkId` come together or not at all. */
export const createThreadSchema = z
  .object({
    subject: threadSubjectSchema,
    body: messageTextSchema.default(''),
    linkType: messageLinkTypeSchema.optional(),
    linkId: uuidSchema.optional(),
  })
  .refine((v) => (v.linkType === undefined) === (v.linkId === undefined), {
    message: 'linkType and linkId go together',
    path: ['linkId'],
  });
export type CreateThreadInput = z.infer<typeof createThreadSchema>;

export const messageReplySchema = z.object({ body: messageTextSchema.default('') });
export type MessageReplyInput = z.infer<typeof messageReplySchema>;

/**
 * The staff inbox. `waiting=1` keeps the open threads whose last message is the owner's (the
 * Today line); `assignedTo` is a staff id, `me` or `none`.
 */
export const staffThreadQuerySchema = paginationQuerySchema.extend({
  status: z.enum([...MESSAGE_THREAD_STATUSES, 'all']).default('open'),
  ownerId: uuidSchema.optional(),
  buildingId: uuidSchema.optional(),
  waiting: z
    .enum(['0', '1'])
    .optional()
    .transform((v) => v === '1'),
  assignedTo: z.union([uuidSchema, z.literal('me'), z.literal('none')]).optional(),
});
export type StaffThreadQuery = z.infer<typeof staffThreadQuerySchema>;

export const threadStatusSchema = z.object({ status: messageThreadStatusSchema });
/** null takes the thread off whoever had it. */
export const assignThreadSchema = z.object({ staffId: uuidSchema.nullable() });
