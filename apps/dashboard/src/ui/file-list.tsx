/**
 * Files of an entity (invoice images and PDFs on expenses, photos on work orders): a list with
 * open links streamed through the API, an uploader for editors, and delete.
 */
import { FileText, Image as ImageIcon, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { ApiRequestError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useDeleteFile, useUploadFile, type FileEntityType } from '@/lib/queries-v2';
import type { Attachment } from '@/lib/types';
import { Button, Card } from './primitives';

export function FileList({
  entityType,
  entityId,
  files,
  canEdit,
  uploadLabel,
  emptyLabel,
}: {
  entityType: FileEntityType;
  entityId: string;
  files: Attachment[];
  canEdit: boolean;
  uploadLabel: string;
  emptyLabel: string;
}) {
  const { t, dateTime } = useI18n();
  const upload = useUploadFile();
  const remove = useDeleteFile();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File) {
    setError(null);
    try {
      await upload.mutateAsync({ entityType, entityId, file });
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t('error_generic'));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {files.length === 0 ? (
        <p className="text-[14px] text-ink-faint">{emptyLabel}</p>
      ) : (
        <Card className="overflow-hidden">
          <ul>
            {files.map((f) => (
              <li
                key={f.id}
                className="row-line flex flex-wrap items-center gap-3 px-4 py-3 last:border-b-0"
              >
                {f.mime.startsWith('image/') ? (
                  <ImageIcon className="size-5 shrink-0 text-ink-soft" aria-hidden />
                ) : (
                  <FileText className="size-5 shrink-0 text-ink-soft" aria-hidden />
                )}
                <a
                  href={`/api/staff/attachments/${f.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 truncate font-medium hover:underline"
                  dir="auto"
                >
                  {f.fileName || f.id}
                </a>
                <span className="text-[13px] text-ink-soft tnum">
                  {Math.max(1, Math.round(f.sizeBytes / 1024))} KB · {dateTime(f.createdAt)}
                </span>
                {canEdit ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`${t('file_delete')} ${f.fileName || f.id}`}
                    loading={remove.isPending && remove.variables === f.id}
                    onClick={() => void remove.mutateAsync(f.id).catch(() => undefined)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {canEdit ? (
        <div className="flex items-center gap-3">
          <input
            ref={input}
            type="file"
            accept="image/*,application/pdf"
            className="sr-only"
            aria-label={uploadLabel}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = '';
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            loading={upload.isPending}
            onClick={() => input.current?.click()}
          >
            <Upload className="size-4" aria-hidden />
            {uploadLabel}
          </Button>
          {error ? <span className="text-[13px] text-danger">{error}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
