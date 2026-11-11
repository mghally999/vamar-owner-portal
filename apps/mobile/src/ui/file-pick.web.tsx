/// <reference lib="dom" />
/**
 * Web app: a hidden file input behind a secondary button, photos and PDFs only. The API checks the
 * type from the file's own bytes and the 10 MB limit again; this is only the first filter.
 */
import { useRef } from 'react';
import type { PickedFile } from '@/lib/message-queries';
import { Button } from './index';

export function FilePickButton({
  label,
  onPick,
  disabled,
}: {
  label: string;
  onPick: (file: PickedFile) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        aria-label={label}
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick({ name: f.name, size: f.size, mime: f.type, data: f });
          e.target.value = '';
        }}
      />
      <Button
        title={label}
        variant="secondary"
        disabled={disabled}
        onPress={() => input.current?.click()}
      />
    </>
  );
}
