import { useI18n } from '@/lib/i18n';
import { Card, PageHeader } from '@/ui/primitives';
import { Page } from '@/ui/shell';

/** Excel import arrives in Phase 5 (SheetJS in the browser, dry run, batched commit). */
export function ImportPage() {
  const { t } = useI18n();
  return (
    <Page>
      <PageHeader title={t('import_title')} subtitle={t('import_intro')} />
      <Card className="px-5 py-8 text-[15px] text-ink-soft">{t('import_pickFile')}</Card>
    </Page>
  );
}
