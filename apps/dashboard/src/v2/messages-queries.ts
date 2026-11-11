/** Owner messages: the inbox, one thread, the header counts and the staff writes. */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MessageLinkType, MessageSenderType, MessageThreadStatus } from '@vamar/shared';
import { qs, request } from '@/lib/api';
import { keys } from '@/lib/queries';

/** As the API sends them (apps/api/src/services/messages.ts); instants are ISO strings. */
export interface MessageLink {
  type: MessageLinkType;
  id: string;
  labelAr: string;
  labelEn: string;
}

export interface ThreadRow {
  id: string;
  subject: string;
  status: MessageThreadStatus;
  link: MessageLink | null;
  lastMessageAt: string;
  lastSenderType: MessageSenderType;
  preview: string;
  unread: number;
  createdAt: string;
  owner: { id: string; nameAr: string; nameEn: string };
  assignedStaff: { id: string; name: string } | null;
  waiting: boolean;
  closedAt: string | null;
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

export interface ThreadDetail extends ThreadRow {
  messages: ThreadMessage[];
}

export interface InboxFilters {
  status: MessageThreadStatus | 'all';
  waiting?: boolean | undefined;
  ownerId?: string | undefined;
  buildingId?: string | undefined;
  mine?: boolean | undefined;
}

export const messageKeys = {
  list: ['messages', 'list'] as const,
  inbox: (f: InboxFilters) => ['messages', 'list', f] as const,
  counts: ['messages', 'counts'] as const,
  thread: (id: string) => ['messages', 'thread', id] as const,
  assignees: ['messages', 'assignees'] as const,
};

export function useInbox(f: InboxFilters) {
  return useInfiniteQuery({
    queryKey: messageKeys.inbox(f),
    queryFn: ({ pageParam }) =>
      request<{ items: ThreadRow[]; nextCursor: string | null }>(
        `/api/staff/messages${qs({
          status: f.status,
          waiting: f.waiting ? 1 : undefined,
          ownerId: f.ownerId,
          buildingId: f.buildingId,
          assignedTo: f.mine ? 'me' : undefined,
          cursor: pageParam,
          limit: 50,
        })}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** The header badge: open threads with an owner message nobody on staff has read yet. */
export function useMessageCounts() {
  return useQuery({
    queryKey: messageKeys.counts,
    queryFn: () =>
      request<{ unreadThreads: number; waiting: number }>('/api/staff/messages/counts'),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });
}

export function useThread(id: string) {
  return useQuery({
    queryKey: messageKeys.thread(id),
    queryFn: () => request<ThreadDetail>(`/api/staff/messages/${id}`),
  });
}

export function useAssignees(enabled: boolean) {
  return useQuery({
    queryKey: messageKeys.assignees,
    queryFn: () =>
      request<{ items: { id: string; name: string; role: string }[] }>(
        '/api/staff/messages/assignees',
      ).then((r) => r.items),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** A write moves the thread, the inbox, the header badge and the Today line together. */
function useInvalidate(id: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: messageKeys.thread(id) });
    void qc.invalidateQueries({ queryKey: messageKeys.list });
    void qc.invalidateQueries({ queryKey: messageKeys.counts });
    void qc.invalidateQueries({ queryKey: keys.overview });
  };
}

/** Staff have read the thread: only the lists and the badge change, not the thread itself. */
export function useMarkRead(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request(`/api/staff/messages/${id}/read`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: messageKeys.list });
      void qc.invalidateQueries({ queryKey: messageKeys.counts });
    },
  });
}

/** JSON for text alone; a form when a file goes with it (one file per message). */
export function useReply(id: string) {
  const invalidate = useInvalidate(id);
  return useMutation({
    mutationFn: ({ body, file }: { body: string; file: File | null }) => {
      if (!file)
        return request(`/api/staff/messages/${id}/messages`, {
          method: 'POST',
          body: JSON.stringify({ body }),
        });
      const form = new FormData();
      form.set('body', body);
      form.set('file', file);
      return request(`/api/staff/messages/${id}/messages`, { method: 'POST', body: form });
    },
    onSuccess: invalidate,
  });
}

export function useSetThreadStatus(id: string) {
  const invalidate = useInvalidate(id);
  return useMutation({
    mutationFn: (status: MessageThreadStatus) =>
      request(`/api/staff/messages/${id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      }),
    onSuccess: invalidate,
  });
}

export function useAssignThread(id: string) {
  const invalidate = useInvalidate(id);
  return useMutation({
    mutationFn: (staffId: string | null) =>
      request(`/api/staff/messages/${id}/assign`, {
        method: 'POST',
        body: JSON.stringify({ staffId }),
      }),
    onSuccess: invalidate,
  });
}
