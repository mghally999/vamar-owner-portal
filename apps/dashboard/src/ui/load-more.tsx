import { useI18n } from '@/lib/i18n';
import { Button } from './primitives';

/** The parts of a TanStack infinite query the footer needs. */
export interface PagedQuery {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => Promise<unknown>;
}

/** The "Load more" footer under a cursor-paged list; nothing once the last page is in. */
export function LoadMore({ query }: { query: PagedQuery }) {
  const { t } = useI18n();
  if (!query.hasNextPage) return null;
  return (
    <div className="border-t border-line p-3">
      <Button
        variant="secondary"
        size="sm"
        loading={query.isFetchingNextPage}
        onClick={() => void query.fetchNextPage()}
      >
        {t('loadMore')}
      </Button>
    </div>
  );
}
