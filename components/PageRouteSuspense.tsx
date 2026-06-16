import React, { Suspense, useEffect, useState } from 'react';
import { SectionLoadingPlaceholder } from './shared/SectionLoadingPlaceholder';
import { isEagerShellPage } from '../utils/lazyPages';
import type { Page } from '../types';

const SLOW_LOAD_MS = 12_000;

/**
 * Wraps lazy route segments. Shell chrome (header/nav) stays interactive; only the main column shows a section placeholder.
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
        <div className="flex flex-col gap-3">
          <SectionLoadingPlaceholder
            compact
            label={slow ? 'Still loading this page…' : 'Loading page…'}
            minHeight="8rem"
          />
          {slow && (
            <button
              type="button"
              className="text-sm font-medium text-primary hover:underline self-center"
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
