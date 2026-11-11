/**
 * Owner messages on the dashboard: the inbox at /messages (filters in the URL, so the Today tile
 * and the header link can open it filtered) and one thread at /messages/$threadId. Every text an
 * owner or a colleague wrote is rendered as text: React escapes it, nothing is parsed as HTML.
 * Viewers read; data entry and admins answer, close, reopen and assign.
 */
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { ArrowLeft, FileText, Image as ImageIcon, Paperclip, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type SyntheticEvent } from 'react';
import {
  MAX_MESSAGE_LENGTH,
  MESSAGE_THREAD_STATUSES,
  normalizeMessageText,
  textLength,
  type MessageThreadStatus,
} from '@vamar/shared';
import { ApiRequestError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useBuildings } from '@/lib/queries';
import { OwnerPicker } from '@/ui/owner-picker';
import {
  Button,
  Card,
  Checkbox,
  cx,
  EmptyState,
  ErrorState,
  PageHeader,
  Select,
  Skeleton,
  SkeletonRows,
  Textarea,
  Toast,
} from '@/ui/primitives';
import { Page } from '@/ui/shell';
import { useMessageText } from './messages-messages';
import {
  useAssignees,
  useAssignThread,
  useInbox,
  useMarkRead,
  useReply,
  useSetThreadStatus,
  useThread,
  type InboxFilters,
  type MessageFile,
  type MessageLink,
  type ThreadMessage,
  type ThreadRow,
} from './messages-queries';

function StatusChip({ status }: { status: MessageThreadStatus }) {
  const { statusLabel } = useMessageText();
  return (
    <span
      className={cx(
        'inline-flex h-6 items-center rounded-sm px-2 text-[13px] font-medium',
        status === 'open'
          ? 'bg-status-cleared-bg text-status-cleared'
          : 'bg-status-cancelled-bg text-status-cancelled',
      )}
    >
      {statusLabel(status)}
    </span>
  );
}

/** "Cheque 849342 · Al Noor Tower 801", as a link to the item's own page. */
function ItemLink({ link }: { link: MessageLink }) {
  const { pick, linkLabel } = useMessageText();
  const text = `${linkLabel(link.type)} ${pick(link.labelAr, link.labelEn)}`.trim();
  const className = 'font-medium text-ink underline-offset-2 hover:underline';
  switch (link.type) {
    case 'unit':
      return (
        <Link to="/units/$unitId" params={{ unitId: link.id }} className={className} dir="auto">
          {text}
        </Link>
      );
    case 'cheque':
      return (
        <Link
          to="/cheques/$chequeId"
          params={{ chequeId: link.id }}
          className={className}
          dir="auto"
        >
          {text}
        </Link>
      );
    case 'expense':
      return (
        <Link
          to="/expenses/$expenseId"
          params={{ expenseId: link.id }}
          className={className}
          dir="auto"
        >
          {text}
        </Link>
      );
    case 'work_order':
      return (
        <Link
          to="/work-orders/$workOrderId"
          params={{ workOrderId: link.id }}
          className={className}
          dir="auto"
        >
          {text}
        </Link>
      );
    case 'dispute':
      return (
        <Link
          to="/disputes/$disputeId"
          params={{ disputeId: link.id }}
          className={className}
          dir="auto"
        >
          {text}
        </Link>
      );
  }
}

// Inbox -------------------------------------------------------------------------------------------

const isOn = (v: unknown) => v === 1 || v === '1' || v === true;
const idOf = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined);

function readFilters(url: Record<string, unknown>): InboxFilters {
  const status = url['status'];
  return {
    status:
      status === 'all' || (MESSAGE_THREAD_STATUSES as readonly unknown[]).includes(status)
        ? (status as InboxFilters['status'])
        : 'open',
    waiting: isOn(url['waiting']),
    mine: isOn(url['mine']),
    ownerId: idOf(url['ownerId']),
    buildingId: idOf(url['buildingId']),
  };
}

function InboxRow({ row }: { row: ThreadRow }) {
  const { t, pick, dateTime } = useMessageText();
  const preview = row.preview
    ? `${row.lastSenderType === 'staff' ? t('messages_vamarPrefix') : ''}${row.preview}`
    : t('messages_fileOnly');
  return (
    <li className="row-line last:border-b-0">
      <Link
        to="/messages/$threadId"
        params={{ threadId: row.id }}
        className="flex flex-col gap-1 px-4 py-3 hover:bg-sunken"
      >
        <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span
            className={cx('min-w-0 text-[15px] break-words', row.unread > 0 && 'font-semibold')}
            dir="auto"
          >
            {row.subject}
          </span>
          <span className="tnum text-[13px] text-ink-soft">{dateTime(row.lastMessageAt)}</span>
        </span>
        <span className="text-[14px] text-ink-soft">
          {pick(row.owner.nameAr, row.owner.nameEn)}
        </span>
        <span className="line-clamp-2 text-[14px] break-words text-ink-soft" dir="auto">
          {preview}
        </span>
        <span className="flex flex-wrap items-center gap-2 text-[13px]">
          {row.unread > 0 ? (
            <span className="tnum inline-flex h-6 items-center rounded-sm bg-primary px-2 font-medium text-on-primary">
              {t('messages_unread', { n: row.unread })}
            </span>
          ) : null}
          {row.waiting ? (
            <span className="inline-flex h-6 items-center rounded-sm bg-status-upcoming-bg px-2 font-medium text-status-upcoming">
              {t('messages_waitingBadge')}
            </span>
          ) : null}
          {row.status === 'closed' ? <StatusChip status="closed" /> : null}
          {row.assignedStaff ? (
            <span className="text-ink-soft">
              {t('messages_assignedTo', { name: row.assignedStaff.name })}
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}

/** /messages: the inbox, latest activity first. */
export function MessagesPage() {
  const { t, pick, statusLabel } = useMessageText();
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- routes carry no search schema
  const url = useSearch({ strict: false }) as Record<string, unknown>;
  const filters = readFilters(url);
  const navigate = useNavigate();
  const buildings = useBuildings();
  const q = useInbox(filters);
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];

  const set = (patch: Partial<InboxFilters>) => {
    const next = { ...filters, ...patch };
    void navigate({
      to: '.',
      replace: true,
      search: {
        status: next.status === 'open' ? undefined : next.status,
        waiting: next.waiting ? 1 : undefined,
        mine: next.mine ? 1 : undefined,
        ownerId: next.ownerId,
        buildingId: next.buildingId,
      },
    } as never);
  };

  return (
    <Page>
      <PageHeader title={t('messages_title')} subtitle={t('messages_subtitle')} />
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={filters.status}
          aria-label={t('messages_status')}
          className="w-40"
          onChange={(e) => {
            set({ status: e.target.value as InboxFilters['status'] });
          }}
        >
          {MESSAGE_THREAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
          <option value="all">{t('messages_status_all')}</option>
        </Select>
        <OwnerPicker
          value={filters.ownerId ?? ''}
          onChange={(id) => {
            set({ ownerId: id || undefined });
          }}
          className="w-64"
        />
        <Select
          value={filters.buildingId ?? ''}
          aria-label={t('messages_building')}
          className="w-56"
          onChange={(e) => {
            set({ buildingId: e.target.value || undefined });
          }}
        >
          <option value="">{t('messages_building_all')}</option>
          {(buildings.data ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {pick(b.nameAr, b.nameEn)}
            </option>
          ))}
        </Select>
        <Checkbox
          label={t('messages_waiting')}
          checked={filters.waiting === true}
          onChange={(e) => {
            set({ waiting: e.target.checked });
          }}
        />
        <Checkbox
          label={t('messages_mine')}
          checked={filters.mine === true}
          onChange={(e) => {
            set({ mine: e.target.checked });
          }}
        />
      </div>
      {q.isPending ? (
        <SkeletonRows rows={4} cols={3} />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('messages_empty')} />
      ) : (
        <div className="flex flex-col gap-3">
          <Card className="overflow-hidden">
            <ul aria-label={t('messages_title')}>
              {rows.map((r) => (
                <InboxRow key={r.id} row={r} />
              ))}
            </ul>
          </Card>
          {q.hasNextPage ? (
            <Button
              variant="secondary"
              className="self-start"
              loading={q.isFetchingNextPage}
              onClick={() => void q.fetchNextPage()}
            >
              {t('messages_more')}
            </Button>
          ) : null}
        </div>
      )}
    </Page>
  );
}

// Thread ------------------------------------------------------------------------------------------

function FileLink({ file }: { file: MessageFile }) {
  const Icon = file.mime.startsWith('image/') ? ImageIcon : FileText;
  return (
    <a
      href={`/api/staff/attachments/${file.id}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex max-w-full items-center gap-2 rounded-sm border border-line px-2 py-1 text-[13px] hover:bg-sunken"
    >
      <Icon className="size-4 shrink-0 text-ink-soft" aria-hidden />
      <span className="truncate" dir="auto">
        {file.fileName || file.id}
      </span>
      <span className="tnum shrink-0 text-ink-soft">
        {Math.max(1, Math.round(file.sizeBytes / 1024))} KB
      </span>
    </a>
  );
}

/** One message: the owner's on the start side, Vamar's on the end side, text kept as typed. */
function MessageItem({ m, ownerName }: { m: ThreadMessage; ownerName: string }) {
  const { t, dateTime } = useMessageText();
  const fromOwner = m.senderType === 'owner';
  const who = fromOwner ? ownerName : (m.senderName ?? t('messages_vamar'));
  return (
    <li className={cx('flex', fromOwner ? 'justify-start' : 'justify-end')}>
      <article
        className={cx(
          'flex max-w-[min(36rem,100%)] min-w-0 flex-col gap-1.5 rounded-lg border px-3 py-2',
          fromOwner ? 'border-line bg-elevated' : 'border-line-strong bg-sunken',
        )}
        aria-label={`${who} · ${dateTime(m.createdAt)}`}
      >
        <span className="flex flex-wrap items-baseline justify-between gap-x-3 text-[13px] text-ink-soft">
          <span className="font-medium">{who}</span>
          <span className="tnum">{dateTime(m.createdAt)}</span>
        </span>
        {m.body ? (
          <p className="text-[15px] break-words whitespace-pre-wrap" dir="auto">
            {m.body}
          </p>
        ) : null}
        {m.files.length > 0 ? (
          <span className="flex flex-wrap gap-2">
            {m.files.map((f) => (
              <FileLink key={f.id} file={f} />
            ))}
          </span>
        ) : null}
      </article>
    </li>
  );
}

function ReplyForm({ threadId, onSent }: { threadId: string; onSent: () => void }) {
  const { t } = useMessageText();
  const reply = useReply(threadId);
  const [body, setBody] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const textId = useId();
  const countId = useId();
  const length = textLength(normalizeMessageText(body));
  const tooLong = length > MAX_MESSAGE_LENGTH;

  async function submit(e: SyntheticEvent) {
    e.preventDefault();
    const text = normalizeMessageText(body);
    if (text === '' && !file) {
      setError(t('messages_needText'));
      return;
    }
    if (tooLong) {
      setError(t('messages_tooLong', { max: MAX_MESSAGE_LENGTH }));
      return;
    }
    setError(null);
    try {
      await reply.mutateAsync({ body: text, file });
      setBody('');
      setFile(null);
      onSent();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('messages_sendError'));
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2">
      <label htmlFor={textId} className="text-[13px] font-medium text-ink-soft">
        {t('messages_replyLabel')}
      </label>
      <Textarea
        id={textId}
        value={body}
        dir="auto"
        rows={4}
        invalid={tooLong}
        aria-describedby={countId}
        onChange={(e) => {
          setBody(e.target.value);
        }}
      />
      <span
        id={countId}
        className={cx('tnum text-[13px]', tooLong ? 'text-danger' : 'text-ink-faint')}
        dir="ltr"
      >
        {t('messages_count', { n: length, max: MAX_MESSAGE_LENGTH.toLocaleString('en-US') })}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          accept="image/*,application/pdf"
          className="sr-only"
          aria-label={t('messages_attach')}
          tabIndex={-1}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            e.target.value = '';
          }}
        />
        <Button type="button" variant="secondary" size="sm" onClick={() => input.current?.click()}>
          <Paperclip className="size-4" aria-hidden />
          {t('messages_attach')}
        </Button>
        {file ? (
          <span className="inline-flex max-w-full items-center gap-1 rounded-sm bg-chip px-2 text-[13px] text-on-chip">
            <span className="truncate" dir="auto">
              {file.name}
            </span>
            <button
              type="button"
              className="flex size-8 items-center justify-center"
              aria-label={t('messages_removeFile', { name: file.name })}
              onClick={() => {
                setFile(null);
              }}
            >
              <X className="size-4" aria-hidden />
            </button>
          </span>
        ) : null}
        <Button type="submit" className="ms-auto" loading={reply.isPending}>
          {t('messages_send')}
        </Button>
      </div>
      {error ? (
        <p className="text-[13px] text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function ThreadActions({ thread }: { thread: ThreadRow }) {
  const { t } = useMessageText();
  const assignees = useAssignees(true);
  const setStatus = useSetThreadStatus(thread.id);
  const assign = useAssignThread(thread.id);
  const failed = setStatus.isError || assign.isError;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-[13px] font-medium text-ink-soft">
        {t('messages_assign')}
        <Select
          value={thread.assignedStaff?.id ?? ''}
          className="w-52"
          disabled={assign.isPending}
          onChange={(e) => {
            assign.mutate(e.target.value || null);
          }}
        >
          <option value="">{t('messages_assignNone')}</option>
          {thread.assignedStaff &&
          !(assignees.data ?? []).some((a) => a.id === thread.assignedStaff?.id) ? (
            <option value={thread.assignedStaff.id}>{thread.assignedStaff.name}</option>
          ) : null}
          {(assignees.data ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </label>
      <Button
        variant="secondary"
        size="sm"
        loading={setStatus.isPending}
        onClick={() => {
          setStatus.mutate(thread.status === 'open' ? 'closed' : 'open');
        }}
      >
        {thread.status === 'open' ? t('messages_close') : t('messages_reopen')}
      </Button>
      {failed ? (
        <span className="text-[13px] text-danger" role="alert">
          {t('messages_actionError')}
        </span>
      ) : null}
    </div>
  );
}

/** /messages/$threadId: one thread, oldest message first, the answer box under it. */
export function MessageThreadPage() {
  const { t, pick, dateTime } = useMessageText();
  const auth = useAuth();
  const canAnswer = auth.hasRole('editor');
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- shared page, loose params
  const { threadId = '' } = useParams({ strict: false }) as { threadId?: string };
  const q = useThread(threadId);
  const markRead = useMarkRead(threadId);
  const [sent, setSent] = useState(false);
  const lastId = q.data?.messages.at(-1)?.id;

  // Opening the thread, and every newer message that loads, counts as read for staff.
  const { mutate: read } = markRead;
  useEffect(() => {
    if (lastId) read();
  }, [lastId, read]);

  const back = (
    <Link
      to="/messages"
      className="inline-flex min-h-11 items-center gap-2 text-[15px] font-medium hover:underline"
    >
      <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
      {t('messages_back')}
    </Link>
  );

  if (q.isPending)
    return (
      <Page>
        {back}
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-48 w-full" />
      </Page>
    );
  if (q.isError)
    return (
      <Page>
        {back}
        {q.error instanceof ApiRequestError && q.error.status === 404 ? (
          <EmptyState title={t('messages_notFound')} />
        ) : (
          <ErrorState onRetry={() => void q.refetch()} />
        )}
      </Page>
    );

  const thread = q.data;
  const ownerName = pick(thread.owner.nameAr, thread.owner.nameEn);
  return (
    <Page>
      {back}
      <header className="flex flex-col gap-2">
        {/* The owner's own words keep their direction; the heading keeps the page's alignment. */}
        <h1 className="text-title font-semibold break-words">
          <bdi>{thread.subject}</bdi>
        </h1>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] text-ink-soft">
          <StatusChip status={thread.status} />
          <span>
            {t('messages_owner')}:{' '}
            <Link
              to="/owners/$ownerId"
              params={{ ownerId: thread.owner.id }}
              className="font-medium text-ink hover:underline"
            >
              {ownerName}
            </Link>
          </span>
          {thread.link ? (
            <span>
              {t('messages_about')}: <ItemLink link={thread.link} />
            </span>
          ) : null}
        </p>
        {thread.status === 'closed' && thread.closedAt ? (
          <p className="text-[13px] text-ink-soft">
            {t('messages_closedNote', { date: dateTime(thread.closedAt) })}
          </p>
        ) : null}
        {canAnswer ? <ThreadActions thread={thread} /> : null}
      </header>

      <ol className="flex flex-col gap-3" aria-label={thread.subject}>
        {thread.messages.map((m) => (
          <MessageItem key={m.id} m={m} ownerName={ownerName} />
        ))}
      </ol>

      <Card className="p-4">
        {canAnswer ? (
          <ReplyForm
            threadId={thread.id}
            onSent={() => {
              setSent(true);
            }}
          />
        ) : (
          <p className="text-[14px] text-ink-soft">{t('messages_readOnly')}</p>
        )}
      </Card>
      {sent ? <Toast kind="success">{t('messages_sent')}</Toast> : null}
    </Page>
  );
}
