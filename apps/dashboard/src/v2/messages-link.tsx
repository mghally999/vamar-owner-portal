/**
 * The owner messages link in the shell's header: an icon with the number of open threads that
 * have an owner message nobody on staff has read. It sits beside the logo, not in the menu, so
 * the sidebar keeps fitting a 900 px tall screen. The count hides when it is zero or failed.
 */
import { Link } from '@tanstack/react-router';
import { MessageSquare } from 'lucide-react';
import { cx } from '@/ui/primitives';
import { useMessageText } from './messages-messages';
import { useMessageCounts } from './messages-queries';

export function MessagesHeaderLink({ className }: { className?: string }) {
  const { t } = useMessageText();
  const counts = useMessageCounts();
  const unread = counts.data?.unreadThreads ?? 0;
  return (
    <Link
      to="/messages"
      aria-label={unread > 0 ? t('messages_headerUnread', { n: unread }) : t('messages_header')}
      title={t('messages_header')}
      className={cx(
        'relative flex shrink-0 items-center justify-center rounded-md text-on-header-soft hover:bg-hero-tile hover:text-on-header',
        className,
      )}
    >
      <MessageSquare className="size-5" aria-hidden />
      {unread > 0 ? (
        <span
          className="tnum absolute -end-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-on-header px-1 text-[11px] font-bold text-header"
          aria-hidden
        >
          {unread > 99 ? '99+' : unread}
        </span>
      ) : null}
    </Link>
  );
}
