/// <reference lib="dom" />
/**
 * Web app: a stored file is fetched with the session's Bearer header (a plain link would get 401)
 * and shown from a local blob address in a new tab. The tab is opened during the tap, before the
 * download, so popup blockers allow it; if the browser still refuses, the file is downloaded.
 */
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

export function localFileName(file: AttachmentFile): string {
  return file.fileName || 'file';
}

/** How long the blob address stays valid: long enough for the tab to load it. */
const REVOKE_AFTER_MS = 60_000;

export async function openAttachment(file: AttachmentFile): Promise<void> {
  const tab = window.open('', '_blank');
  try {
    const get = () => fetch(attachmentUrl(file.id), { headers: authHeaders() });
    let res = await get();
    if (res.status === 401 && (await refreshSession()).ok) res = await get();
    if (!res.ok) throw new AttachmentOpenError(res.status);
    const href = URL.createObjectURL(await res.blob());
    setTimeout(() => {
      URL.revokeObjectURL(href);
    }, REVOKE_AFTER_MS);
    if (tab) {
      tab.location.href = href;
      return;
    }
    const a = document.createElement('a');
    a.href = href;
    a.download = localFileName(file);
    a.click();
  } catch (e) {
    tab?.close();
    throw e;
  }
}
