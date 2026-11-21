import { Link, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useMarkRead, useReply, useThread } from '@/lib/message-queries';
import { useMessageText } from '@/lib/message-text';
import { Card, ErrorState, Skeleton, Text, layout } from '@/ui';
import { linkHref, MessageBubble, MessageComposer, useLinkLabel } from '@/ui/message-parts';

/**
 * One conversation with Vamar: the subject and the item it is about, the messages oldest first,
 * and the reply box. Opening it (and every new message while it is open) marks it read.
 */
export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const tm = useMessageText();
  const linkLabel = useLinkLabel();
  const q = useThread(id);
  const th = q.data;
  const read = useMarkRead();
  // The thread's own id: the screen may have been opened with a message id from a push.
  const threadId = th?.id ?? id;
  const reply = useReply(threadId, id);
  const lastId = th?.messages.at(-1)?.id;
  const hasUnread = (th?.unread ?? 0) > 0;

  // Only when something is unread: a read thread costs no request (and no list refetch).
  const { mutate: markRead } = read;
  useEffect(() => {
    if (th?.id && lastId && hasUnread) markRead(th.id);
  }, [th?.id, lastId, hasUnread, markRead]);

  // Oldest first with the reply box last: open at the newest message, and follow each new one.
  const scroll = useRef<ScrollView>(null);
  const shownLast = useRef<string | undefined>(undefined);

  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;

  return (
    <ScrollView
      ref={scroll}
      contentContainerStyle={layout.screen}
      keyboardShouldPersistTaps="handled"
      onContentSizeChange={() => {
        if (!lastId || shownLast.current === lastId) return;
        // The first time without animation (the screen opens there), later ones scroll.
        scroll.current?.scrollToEnd({ animated: shownLast.current !== undefined });
        shownLast.current = lastId;
      }}
    >
      <View style={{ gap: 6, paddingVertical: 8 }}>
        {th ? (
          <>
            <Text variant="title" weight="semibold">
              {th.subject}
            </Text>
            {th.link ? (
              <Link href={linkHref(th.link)} asChild>
                <Pressable
                  accessibilityRole="link"
                  style={{ minHeight: 32, justifyContent: 'center' }}
                >
                  <Text variant="secondary" color="primary">
                    {tm('message_about', { label: linkLabel(th.link) })}
                  </Text>
                </Pressable>
              </Link>
            ) : null}
          </>
        ) : (
          <Skeleton width={240} height={28} />
        )}
      </View>

      {!th ? (
        <Skeleton height={160} radius={12} />
      ) : (
        <View style={{ gap: 10 }}>
          {th.messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
        </View>
      )}

      {th?.status === 'closed' ? (
        <Card style={{ padding: 16 }}>
          <Text variant="secondary" color="soft">
            {tm('message_closed')}
          </Text>
        </Card>
      ) : null}

      {th ? (
        <MessageComposer
          label={tm('message_reply')}
          sending={reply.isPending}
          onSend={(text, file) => reply.mutateAsync({ text, file })}
        />
      ) : null}
    </ScrollView>
  );
}
