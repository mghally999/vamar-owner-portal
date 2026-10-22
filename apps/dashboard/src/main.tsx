import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiRequestError } from '@/lib/api';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuth } from '@/lib/auth';
import { LangProvider } from '@/lib/i18n';
import { router } from '@/router';
import { applyTheme } from '@/lib/theme';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      // Neon suspends after a few idle minutes and the first request can take seconds or fail
      // once while it wakes; retry transient failures with backoff instead of showing an error.
      retry: (failureCount, error) => {
        if (failureCount >= 5) return false;
        if (error instanceof ApiRequestError) {
          // 429 is the API asking us to stop, not a transient failure.
          return error.status === 0 || error.status === 408 || error.status >= 500;
        }
        return true; // network error / fetch failed
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      refetchOnWindowFocus: false,
    },
  },
});

function App() {
  const auth = useAuth();
  return <RouterProvider router={router} context={{ auth, queryClient }} />;
}

applyTheme();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root missing');
createRoot(rootEl).render(
  <StrictMode>
    <LangProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </QueryClientProvider>
    </LangProvider>
  </StrictMode>,
);
