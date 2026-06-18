import React from 'react';
import type { QuotesPriceSource } from '../../context/MarketDataContext';
import { useQuoteRefreshCooldownMs } from '../../hooks/useQuoteRefreshCooldown';
import { shouldPromptForLiveQuoteRefresh } from '../../services/quoteSessionStatus';

type Props = {
  quotesPriceSource: QuotesPriceSource;
  lastUpdated: Date | null;
};

/** Shown on Investments when quotes are simulated/cached or rate-limited. */
const InvestmentsQuoteStatusBanner: React.FC<Props> = ({ quotesPriceSource, lastUpdated }) => {
  const cooldownMs = useQuoteRefreshCooldownMs();
  const needsRefresh = shouldPromptForLiveQuoteRefresh(quotesPriceSource);
  if (!needsRefresh && cooldownMs <= 0) return null;

  return (
    <div
      className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800"
      role="status"
    >
      {needsRefresh && (
        <p>
          <strong>
            {quotesPriceSource === 'cached' ? 'Prices are from your saved cache' : 'Prices are simulated'}
          </strong>{' '}
          — use <strong>Refresh prices</strong> in the header (or <strong>Sync quotes</strong> on a platform) for a
          live pull.
        </p>
      )}
      {cooldownMs > 0 && (
        <p className={needsRefresh ? 'mt-1 text-amber-800' : 'text-amber-800'}>
          Quote refresh paused ~{Math.ceil(cooldownMs / 1000)}s after rate limit — cached prices still apply.
        </p>
      )}
      {lastUpdated && (
        <p className="mt-1 text-xs text-slate-500">Last quote tick: {lastUpdated.toLocaleString()}</p>
      )}
    </div>
  );
};

export default React.memo(InvestmentsQuoteStatusBanner);
