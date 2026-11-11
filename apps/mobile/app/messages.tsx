import { Link } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { MESSAGE_THREAD_STATUS_LABEL } from '@vamar/shared';
import { useI18n } from '@/lib/i18n';
import { useThreads } from '@/lib/message-queries';
import { messageTime, useMessageText } from '@/lib/message-text';
import { useTheme } from '@/lib/theme';
import { Button, Card, Chip, EmptyState, ErrorState, Row, Skeleton, Text, layout } from '@/ui';
import { useLinkLabel } from '@/ui/message-parts';

/** The owner's conversations with Vamar, latest activity first, with what is still unread. */
export default function MessagesScreen() {
  const t = useTheme();
  const tm = useMessageText();
  const { lang } = useI18n();
  const linkLabel = useLinkLabel();
  const q = useThreads();

  const newButton = (
    <Link href="/message/new" asChild>
      <Button title={tm('messages_new')} />
    </Link>
  );

  if (q.isPending)
    return (
      <View style={{ padding: 16, gap: 12 }}>
        <Skeleton height={88} radius={12} />
        <Skeleton height={88} radius={12} />
      </View>
    );
  if (q.isError)
    return (
      <View style={{ padding: 16 }}>
        <ErrorState onRetry={() => void q.refetch()} />
      </View>
    );

  return (
    <ScrollView contentContainerStyle={layout.screen}>
      {newButton}
      {q.data.items.length === 0 ? (
        <EmptyState title={tm('messages_empty')} body={tm('messages_empty_body')} />
      ) : (
        q.data.items.map((th) => (
          <Link key={th.id} href={{ pathname: '/message/[id]', params: { id: th.id } }} asChild>
            <Pressable accessibilityRole="button" testID={`thread-${th.id}`}>
              <Card style={{ padding: 16, gap: 6 }}>
                <Row style={{ justifyContent: 'space-between', gap: 8 }}>
                  <Text
                    weight={th.unread > 0 ? 'semibold' : 'medium'}
                    numberOfLines={2}
                    style={{ flex: 1 }}
                  >
                    {th.subject}
                  </Text>
                  {th.unread > 0 ? (
                    <View
                      style={{
                        backgroundColor: t.colors.primary,
                        borderRadius: t.radius.full,
                        paddingHorizontal: 10,
                        paddingVertical: 3,
                      }}
                    >
                      <Text variant="caption" weight="medium" color="onPrimary" tnum>
                        {tm('messages_unread', { n: th.unread })}
                      </Text>
                    </View>
                  ) : th.status === 'closed' ? (
                    <Chip label={MESSAGE_THREAD_STATUS_LABEL.closed[lang]} />
                  ) : null}
                </Row>
                {th.link ? (
                  <Text variant="caption" color="soft" numberOfLines={1}>
                    {linkLabel(th.link)}
                  </Text>
                ) : null}
                <Text variant="secondary" color="soft" numberOfLines={2}>
                  {th.lastSenderType === 'staff' ? `${tm('message_vamar')}: ` : ''}
                  {th.preview || tm('message_file_only')}
                </Text>
                <Text variant="caption" color="faint" tnum>
                  {messageTime(th.lastMessageAt, lang)}
                </Text>
              </Card>
            </Pressable>
          </Link>
        ))
      )}
    </ScrollView>
  );
}
