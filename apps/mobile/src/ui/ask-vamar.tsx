/**
 * "Ask Vamar about this" at the foot of a unit, cheque, expense, work order or case screen: opens
 * a new message linked to the item, with the subject filled in from what the screen shows.
 */
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import type { MessageLinkType } from '@vamar/shared';
import { useMessageText } from '@/lib/message-text';
import { Button } from './index';

export function AskVamar({
  type,
  id,
  label,
}: {
  type: MessageLinkType;
  id: string;
  /** What the item is called on screen; nothing shows until the screen has it. */
  label: string | null | undefined;
}) {
  const router = useRouter();
  const tm = useMessageText();
  if (!label) return null;
  return (
    <View>
      <Button
        title={tm('ask_vamar')}
        variant="secondary"
        onPress={() => {
          router.push({ pathname: '/message/new', params: { linkType: type, linkId: id, label } });
        }}
      />
    </View>
  );
}
