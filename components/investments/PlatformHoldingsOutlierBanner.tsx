import React from 'react';
import type { HoldingOutlierRow } from '../../services/holdingsOutlierAudit';
import type { Page } from '../../types';

type Props = {
  outliers: HoldingOutlierRow[];
  platformName: string;
  setActivePage?: (page: Page) => void;
};

/** Warn when stored holding values look corrupt (distorts Awaed / platform P/L and net worth). */
const PlatformHoldingsOutlierBanner: React.FC<Props> = ({ outliers, platformName, setActivePage }) => {
  if (outliers.length === 0) return null;

  return (
    <div className="mx-4 mt-3 mb-1 rounded-lg border border-rose-200 bg-rose-50/90 px-3 py-2 text-xs text-rose-950" role="alert">
      <p className="font-semibold">Holdings data may be corrupt on {platformName}</p>
      <p className="mt-0.5 text-rose-900/90 leading-relaxed">
        {outliers.length} position{outliers.length !== 1 ? 's' : ''} have extreme stored values — platform P/L uses net deposits,
        but net worth and quotes can still look wrong until you fix rows in Supabase.
      </p>
      <ul className="mt-1.5 list-disc pl-4 space-y-0.5">
        {outliers.slice(0, 3).map((r) => (
          <li key={r.holdingId}>
            {r.symbol}: {r.currentValue.toLocaleString()} SAR — {r.reason}
          </li>
        ))}
      </ul>
      {setActivePage && (
        <button
          type="button"
          className="mt-2 font-semibold text-primary hover:underline"
          onClick={() => setActivePage('System & APIs Health')}
        >
          Open System Health →
        </button>
      )}
    </div>
  );
};

export default React.memo(PlatformHoldingsOutlierBanner);
