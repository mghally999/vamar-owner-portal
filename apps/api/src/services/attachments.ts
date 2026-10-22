/**
 * Files live in a private R2 bucket. Uploads and downloads stream through the Worker after an
 * auth check; the bucket is never public. Images and PDFs only, 10 MB max, type decided from the
 * file's own bytes.
 *
 * Storage and database are two systems, so writes are ordered to fail safe: the row is written
 * inside the caller's transaction and the object afterwards; if the object cannot be stored the
 * transaction rolls back and the object is removed. Deletions remove the row in the transaction
 * and the object only after commit (the route does that with `waitUntil`).
 */
import { and, eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { schema } from '@vamar/db';
import type { AttachmentEntityType } from '@vamar/shared';
import type { Dbx } from '../db.js';
import type { AppEnv } from '../env.js';
import { ApiError, notFound } from '../errors.js';
import { log } from '../util/log.js';
import { withTimeout } from '../util/outbound.js';
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
const R2_TIMEOUT_MS = 20_000;

const MAGIC: [string, number[]][] = [
  ['image/jpeg', [0xff, 0xd8, 0xff]],
  ['image/png', [0x89, 0x50, 0x4e, 0x47]],
  ['application/pdf', [0x25, 0x50, 0x44, 0x46]],
  ['image/webp', [0x52, 0x49, 0x46, 0x46]],
];

/** The type the bytes say the file is; `null` when they match nothing we accept. */
export function sniffMime(bytes: Uint8Array): string | null {
  for (const [mime, magic] of MAGIC) {
    if (magic.every((b, i) => bytes[i] === b)) {
      if (mime === 'image/webp' && !(bytes[8] === 0x57 && bytes[9] === 0x45)) continue;
      return mime;
    }
  }
  // HEIC has an ftyp box at offset 4
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70)
    return 'image/heic';
  return null;
}

/** The record an attachment points at must exist. */
async function assertEntityExists(db: Dbx, type: AttachmentEntityType, id: string): Promise<void> {
  const table = {
    cheque: schema.cheques,
    dispute: schema.disputes,
    contract: schema.contracts,
    unit: schema.units,
  }[type];
  const [row] = await db.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1);
  if (!row) throw notFound(type.charAt(0).toUpperCase() + type.slice(1));
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
  const mime = sniffMime(head);
  if (!mime || !ALLOWED_MIME.has(mime))
    throw new ApiError(422, 'validation', 'Only images and PDF files are allowed');
  await assertEntityExists(db, input.entityType, input.entityId);
  const ext = mime === 'application/pdf' ? 'pdf' : (mime.split('/')[1] ?? 'bin');
  const key = `${input.entityType}/${input.entityId}/${crypto.randomUUID()}.${ext}`;
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
  try {
    await withTimeout(
      () => bucket.put(key, input.file.stream(), { httpMetadata: { contentType: mime } }),
      R2_TIMEOUT_MS,
      'r2 put',
    );
  } catch (e) {
    // The transaction will roll back the row; make sure no half-written object survives.
    await bucket.delete(key).catch(() => undefined);
    log('error', 'r2.put_failed', { key, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
  return row;
}

/** Removes the row and audit inside the transaction; returns the key to delete after commit. */
export async function deleteAttachment(
  db: Dbx,
  actor: AuditActor,
  id: string,
): Promise<{ r2Key: string }> {
  const row = await db.query.attachments.findFirst({ where: eq(schema.attachments.id, id) });
  if (!row) throw notFound('Attachment');
  await db.delete(schema.attachments).where(eq(schema.attachments.id, id));
  await audit(db, actor, {
    action: 'attachment.delete',
    entityType: row.entityType,
    entityId: row.entityId,
    before: row,
  });
  return { r2Key: row.r2Key };
}

/** Best-effort object removal after the database change committed. */
export async function removeObject(bucket: R2Bucket, key: string): Promise<void> {
  try {
    await withTimeout(() => bucket.delete(key), R2_TIMEOUT_MS, 'r2 delete');
  } catch (e) {
    log('warn', 'r2.delete_failed', { key, error: e instanceof Error ? e.message : String(e) });
  }
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
  const obj = await withTimeout(() => bucket.get(key), R2_TIMEOUT_MS, 'r2 get');
  if (!obj) throw notFound('File');
  const mime = meta?.mime ?? obj.httpMetadata?.contentType ?? 'application/octet-stream';
  const headers = new Headers();
  headers.set('content-type', mime);
  // Cheque images and court papers: the browser may keep them for the session, nothing else may.
  headers.set('cache-control', 'private, no-store');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('content-security-policy', "sandbox; default-src 'none'");
  if (meta?.fileName) {
    // PDFs download instead of rendering in the origin's context.
    const disposition = mime === 'application/pdf' ? 'attachment' : 'inline';
    headers.set(
      'content-disposition',
      `${disposition}; filename*=UTF-8''${encodeURIComponent(meta.fileName)}`,
    );
  }
  if (obj.etag) headers.set('etag', obj.etag);
  return c.body(obj.body, 200, Object.fromEntries(headers.entries()));
}
