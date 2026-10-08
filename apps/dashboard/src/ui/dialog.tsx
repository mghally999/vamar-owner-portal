import { Dialog as RadixDialog } from 'radix-ui';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const { t } = useI18n();
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-[rgba(22,40,66,0.35)]" />
        <RadixDialog.Content
          className={`fixed start-1/2 top-1/2 z-50 max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg bg-elevated p-6 shadow-card focus:outline-none rtl:translate-x-1/2 ${wide ? 'max-w-3xl' : 'max-w-lg'}`}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <RadixDialog.Title className="text-heading font-semibold">{title}</RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-1 text-[15px] text-ink-soft">
                  {description}
                </RadixDialog.Description>
              ) : null}
            </div>
            <RadixDialog.Close
              className="-me-2 -mt-2 flex size-11 items-center justify-center rounded-md text-ink-soft hover:bg-sunken"
              aria-label={t('close')}
            >
              <X className="size-5" />
            </RadixDialog.Close>
          </div>
          <div>{children}</div>
          {footer ? <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
