/**
 * Files live in a private R2 bucket. Uploads and downloads stream through the Worker after an
 * auth check; the bucket is never public. Images and PDFs only, 10 MB max.
 */
import { and, eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { schema } from '@vamar/db';
import type { AttachmentEntityType } from '@vamar/shared';
import type { Dbx } from '../db.js';
import type { AppEnv } from '../env.js';
import { ApiError, notFound } from '../errors.js';
import { audit, type AuditActor } from './audit.js';
import { disputeInOwnerScope } from './owner-scope.js';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
]);

const MAGIC: [string, number[]][] = [
  ['image/jpeg', [0xff, 0xd8, 0xff]],
  ['image/png', [0x89, 0x50, 0x4e, 0x47]],
  ['application/pdf', [0x25, 0x50, 0x44, 0x46]],
  ['image/webp', [0x52, 0x49, 0x46, 0x46]],
];

/** Validate declared type against the file's first bytes (cheap, no full parse). */
export function sniffMime(bytes: Uint8Array, declared: string): string {
  for (const [mime, magic] of MAGIC) {
    if (magic.every((b, i) => bytes[i] === b)) {
      if (mime === 'image/webp' && !(bytes[8] === 0x57 && bytes[9] === 0x45)) continue;
      return mime;
    }
  }
  // HEIC has an ftyp box at offset 4
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70)
    return 'image/heic';
  return declared;
}

export async function storeUpload(
  db: Dbx,
  bucket: R2Bucket,
  actor: AuditActor,
  input: { entityType: AttachmentEntityType; entityId: string; file: File },
) {
  if (input.file.size <= 0 || input.file.size > MAX_UPLOAD_BYTES) {
    throw new ApiError(422, 'validation', 'File must be between 1 byte and 10 MB');
  }
  const head = new Uint8Array(await input.file.slice(0, 16).arrayBuffer());
  const mime = sniffMime(head, input.file.type);
  if (!ALLOWED_MIME.has(mime))
    throw new ApiError(422, 'validation', 'Only images and PDF files are allowed');
  const ext = mime === 'application/pdf' ? 'pdf' : (mime.split('/')[1] ?? 'bin');
  const key = `${input.entityType}/${input.entityId}/${crypto.randomUUID()}.${ext}`;
  await bucket.put(key, input.file.stream(), { httpMetadata: { contentType: mime } });
  const [row] = await db
    .insert(schema.attachments)
    .values({
      entityType: input.entityType,
      entityId: input.entityId,
      r2Key: key,
      mime,
      sizeBytes: input.file.size,
      fileName: input.file.name.slice(0, 200),
      uploadedBy: actor.type === 'staff' ? actor.id : null,
    })
    .returning();
  if (!row) throw new Error('insert failed');
  await audit(db, actor, {
    action: 'attachment.create',
    entityType: input.entityType,
    entityId: input.entityId,
    after: { id: row.id, fileName: row.fileName, mime, sizeBytes: row.sizeBytes },
  });
  return row;
}

export async function deleteAttachment(db: Dbx, bucket: R2Bucket, actor: AuditActor, id: string) {
  const row = await db.query.attachments.findFirst({ where: eq(schema.attachments.id, id) });
  if (!row) throw notFound('Attachment');
  await bucket.delete(row.r2Key);
  await db.delete(schema.attachments).where(eq(schema.attachments.id, id));
  await audit(db, actor, {
    action: 'attachment.delete',
    entityType: row.entityType,
    entityId: row.entityId,
    before: row,
  });
}

export async function listAttachments(db: Dbx, entityType: AttachmentEntityType, entityId: string) {
  return db
    .select({
      id: schema.attachments.id,
      fileName: schema.attachments.fileName,
      mime: schema.attachments.mime,
      sizeBytes: schema.attachments.sizeBytes,
      createdAt: schema.attachments.createdAt,
    })
    .from(schema.attachments)
    .where(
      and(eq(schema.attachments.entityType, entityType), eq(schema.attachments.entityId, entityId)),
    )
    .orderBy(schema.attachments.createdAt);
}

export async function getAttachmentForStaff(db: Dbx, id: string) {
  const row = await db.query.attachments.findFirst({ where: eq(schema.attachments.id, id) });
  if (!row) throw notFound('Attachment');
  return row;
}

/** Owners may only fetch attachments of disputes on their units. */
export async function getAttachmentForOwner(db: Dbx, ownerId: string, id: string) {
  const row = await db.query.attachments.findFirst({ where: eq(schema.attachments.id, id) });
  if (row?.entityType !== 'dispute') throw notFound('Attachment');
  const dispute = await db
    .select({ id: schema.disputes.id })
    .from(schema.disputes)
    .where(and(eq(schema.disputes.id, row.entityId), disputeInOwnerScope(db, ownerId)));
  if (!dispute.length) throw notFound('Attachment');
  return row;
}

export async function streamObject(
  bucket: R2Bucket,
  key: string,
  c: Context<AppEnv>,
  meta?: { fileName: string; mime: string },
) {
  const obj = await bucket.get(key);
  if (!obj) throw notFound('File');
  const headers = new Headers();
  headers.set(
    'content-type',
    meta?.mime ?? obj.httpMetadata?.contentType ?? 'application/octet-stream',
  );
  headers.set('cache-control', 'private, max-age=300');
  headers.set('x-content-type-options', 'nosniff');
  if (meta?.fileName)
    headers.set(
      'content-disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(meta.fileName)}`,
    );
  if (obj.etag) headers.set('etag', obj.etag);
  return c.body(obj.body, 200, Object.fromEntries(headers.entries()));
}
