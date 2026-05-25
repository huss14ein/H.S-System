import React, { Suspense, useEffect, useState } from 'react';
import LoadingSpinner from './LoadingSpinner';
import { isEagerShellPage } from '../utils/lazyPages';
import type { Page } from '../types';

const SLOW_LOAD_MS = 12_000;

/**
 * Wraps lazy route segments. Eager pages skip Suspense; lazy pages get a slow-load hint.
 */
const PageRouteSuspense: React.FC<{ activePage: Page; children: React.ReactNode }> = ({
  activePage,
  children,
}) => {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (isEagerShellPage(activePage)) {
      setSlow(false);
      return;
    }
    setSlow(false);
    const t = window.setTimeout(() => setSlow(true), SLOW_LOAD_MS);
    return () => window.clearTimeout(t);
  }, [activePage]);

  if (isEagerShellPage(activePage)) {
    return <>{children}</>;
  }

  return (
    <Suspense
      fallback={
        <div className="flex flex-col items-center justify-center min-h-[24rem] gap-4">
          <LoadingSpinner message={slow ? 'Still loading this page…' : 'Loading page…'} />
          {slow && (
            <button
              type="button"
              className="text-sm font-medium text-primary hover:underline"
              onClick={() => window.location.reload()}
            >
              Reload if this does not finish
            </button>
          )}
        </div>
      }
    >
      {children}
    </Suspense>
  );
};

export default PageRouteSuspense;
