/**
 * Files Vamar stores (invoices, quotes, photos, files sent in messages) are served at
 * /api/owner/attachments/:id behind the owner's session (a Bearer header). A browser or the
 * system viewer opened on that address has no header and gets 401, so a file is first downloaded
 * with the session and then handed to the phone (share sheet: open in a PDF viewer, save, send).
 * The web app has its own version in attachments.web.ts.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { API_BASE, authHeaders, refreshSession } from './api';

export interface AttachmentFile {
  id: string;
  fileName: string;
  mime: string;
}

export function attachmentUrl(id: string): string {
  return `${API_BASE}/api/owner/attachments/${id}`;
}

export function isImage(file: Pick<AttachmentFile, 'mime'>): boolean {
  return file.mime.startsWith('image/');
}

export class AttachmentOpenError extends Error {
  constructor(readonly status: number) {
    super(`attachment ${String(status)}`);
  }
}

/** A name the file system accepts, unique per attachment, with the extension viewers need. */
export function localFileName(file: AttachmentFile): string {
  const base = (file.fileName || 'file').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 80);
  const ext = file.mime === 'application/pdf' && !/\.pdf$/i.test(base) ? '.pdf' : '';
  return `${file.id}-${base}${ext}`;
}

export async function openAttachment(file: AttachmentFile): Promise<void> {
  const url = attachmentUrl(file.id);
  const dest = `${FileSystem.cacheDirectory ?? ''}${localFileName(file)}`;
  let res = await FileSystem.downloadAsync(url, dest, { headers: authHeaders() });
  // The access token lasts minutes; a screen left open longer needs a fresh one.
  if (res.status === 401 && (await refreshSession()).ok) {
    res = await FileSystem.downloadAsync(url, dest, { headers: authHeaders() });
  }
  if (res.status !== 200) {
    // What was written is the API's error, not the file.
    await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => undefined);
    throw new AttachmentOpenError(res.status);
  }
  if (!(await Sharing.isAvailableAsync())) throw new AttachmentOpenError(0);
  await Sharing.shareAsync(res.uri, {
    mimeType: file.mime,
    dialogTitle: file.fileName,
    ...(file.mime === 'application/pdf' ? { UTI: 'com.adobe.pdf' } : {}),
  });
}
