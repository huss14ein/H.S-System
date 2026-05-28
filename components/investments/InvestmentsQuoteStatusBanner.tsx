import React from 'react';
import { quoteRefreshCooldownRemainingMs } from '../../services/quoteRefreshCooldown';

type Props = {
  isLive: boolean;
  lastUpdated: Date | null;
};

/** Shown on Investments when quotes are simulated or rate-limited. */
const InvestmentsQuoteStatusBanner: React.FC<Props> = ({ isLive, lastUpdated }) => {
  const cooldownSec = quoteRefreshCooldownRemainingMs();
  if (isLive && cooldownSec <= 0) return null;

  return (
    <div
      className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800"
      role="status"
    >
      {!isLive && (
        <p>
          <strong>Prices are simulated</strong> — set Netlify env keys (SAHMK / Finnhub), open Market Simulator briefly,
          then use header refresh. Shift+click refresh forces a live pull when not rate-limited.
        </p>
      )}
      {cooldownSec > 0 && (
        <p className={!isLive ? 'mt-1 text-amber-800' : 'text-amber-800'}>
          Quote refresh paused ~{Math.ceil(cooldownSec / 1000)}s after rate limit — cached prices still apply.
        </p>
      )}
      {lastUpdated && (
        <p className="mt-1 text-xs text-slate-500">Last quote tick: {lastUpdated.toLocaleString()}</p>
      )}
    </div>
  );
};

export default React.memo(InvestmentsQuoteStatusBanner);
