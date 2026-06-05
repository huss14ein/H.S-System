import React, { useEffect, useState } from 'react';
import { getBuildSha } from '../utils/buildInfo';
import type { Page } from '../types';

const dismissKey = (sha: string) => `finova_wa_guide_dismissed_${sha}`;

/** One-time pointer: advanced charts & AI executive summary live under Wealth Analytics (not missing from Dashboard). */
const WealthAnalyticsGuideBanner: React.FC<{ setActivePage: (page: Page) => void }> = ({ setActivePage }) => {
  const sha = getBuildSha();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (sha === 'dev') {
      setVisible(true);
      return;
    }
    try {
      setVisible(localStorage.getItem(dismissKey(sha)) !== '1');
    } catch {
      setVisible(true);
    }
  }, [sha]);

  if (!visible) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(dismissKey(sha), '1');
    } catch {
      // ignore
    }
    setVisible(false);
  };

  return (
    <div
      className="mb-4 rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-white px-4 py-3 text-sm text-indigo-950 shadow-sm"
      role="status"
    >
      <p className="font-semibold">Looking for charts, health score, or the AI executive summary?</p>
      <p className="mt-1 text-indigo-900/90">
        Those moved to <strong>Overview → Wealth Analytics</strong> (build {sha}). Dashboard stays lean for daily KPIs and cash flow.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setActivePage('Wealth Analytics')}
          className="inline-flex items-center rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
        >
          Open Wealth Analytics
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="inline-flex items-center rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-800 hover:bg-indigo-50"
        >
          Got it — hide for this build
        </button>
      </div>
    </div>
  );
};

export default WealthAnalyticsGuideBanner;
