/**
 * Messages with Vamar (GET/POST /api/owner/messages): the owner's threads, one thread, a new
 * thread, a reply and the read receipt. Kept apart from queries.ts so the feature stays in one
 * place. A message carrying a file goes as a multipart form, one file per message.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MessageLinkType, MessageSenderType, MessageThreadStatus } from '@vamar/shared';
import { ApiRequestError, request } from './api';

export interface MessageLink {
  type: MessageLinkType;
  id: string;
  labelAr: string;
  labelEn: string;
}

export interface ThreadSummary {
  id: string;
  subject: string;
  status: MessageThreadStatus;
  link: MessageLink | null;
  lastMessageAt: string;
  lastSenderType: MessageSenderType;
  preview: string;
  unread: number;
  createdAt: string;
}

export interface MessageFile {
  id: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
}

export interface ThreadMessage {
  id: string;
  senderType: MessageSenderType;
  senderName: string | null;
  body: string;
  createdAt: string;
  files: MessageFile[];
}

export interface ThreadDetail extends ThreadSummary {
  messages: ThreadMessage[];
}

/** A file chosen to go with a message (the web app only: the phone build has no file picker). */
export interface PickedFile {
  name: string;
  size: number;
  mime: string;
  data: Blob;
}

/** The API's limit for any attachment (apps/api/src/services/attachments.ts). */
export const MAX_MESSAGE_FILE_BYTES = 10 * 1024 * 1024;

export const messageKeys = {
  list: ['messages'] as const,
  thread: (id: string) => ['messages', id] as const,
};

export function useThreads() {
  return useQuery({
    queryKey: messageKeys.list,
    queryFn: () =>
      request<{ items: ThreadSummary[]; unreadThreads: number }>('/api/owner/messages'),
  });
}

/** `id` may be a message's id (a tapped reply push); the answer carries the thread's own id. */
export function useThread(id: string) {
  return useQuery({
    queryKey: messageKeys.thread(id),
    queryFn: () => request<ThreadDetail>(`/api/owner/messages/${id}`),
    // A reply from Vamar arrives as a push; while the screen is open, look again now and then.
    refetchInterval: 30_000,
  });
}

function body(
  fields: Record<string, string | undefined>,
  file: PickedFile | null,
): string | FormData {
  if (!file) return JSON.stringify(fields);
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) form.append(k, v);
  form.append('file', file.data, file.name);
  return form;
}

export interface NewThreadInput {
  subject: string;
  body: string;
  linkType?: MessageLinkType | undefined;
  linkId?: string | undefined;
  file?: PickedFile | null;
}

export function useCreateThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file = null, ...fields }: NewThreadInput) =>
      request<ThreadDetail>('/api/owner/messages', {
        method: 'POST',
        body: body(fields, file),
      }),
    onSuccess: (detail) => {
      qc.setQueryData(messageKeys.thread(detail.id), detail);
      void qc.invalidateQueries({ queryKey: messageKeys.list, exact: true });
    },
  });
}

export function useReply(threadId: string, routeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ text, file = null }: { text: string; file?: PickedFile | null }) =>
      request<{ id: string }>(`/api/owner/messages/${threadId}/messages`, {
        method: 'POST',
        body: body({ body: text }, file),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: messageKeys.thread(routeId) });
      void qc.invalidateQueries({ queryKey: messageKeys.list, exact: true });
    },
  });
}

/** The owner has read the thread up to now; the list's unread count follows. */
export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (threadId: string) =>
      request<{ ok: true }>(`/api/owner/messages/${threadId}/read`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: messageKeys.list, exact: true }),
  });
}

/** Which sentence to show when a message could not be sent. */
export function sendErrorKey(e: unknown): 'message_rate_limited' | 'message_error' {
  return e instanceof ApiRequestError && e.status === 429
    ? 'message_rate_limited'
    : 'message_error';
}
