/**
 * Choosing a photo or PDF to send with a message. The phone build has no file picker module (and
 * the app updates over the air without a new one), so on the phone there is nothing to show; the
 * web app has its own version in file-pick.web.tsx. Files Vamar sends still open on the phone.
 */
import type { PickedFile } from '@/lib/message-queries';

export function FilePickButton(_props: {
  label: string;
  onPick: (file: PickedFile) => void;
  disabled?: boolean;
}) {
  return null;
}
