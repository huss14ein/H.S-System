import React from 'react';
import { useDeployFreshness } from '../hooks/useDeployFreshness';
import { getCanonicalAppUrl, VERCEL_MIRROR_APP_URL } from '../utils/buildInfo';

/** Non-blocking banner when the browser is running an older hashed bundle than the live deploy. */
const DeployFreshnessBanner: React.FC = () => {
  const { stale, remoteSha, localSha } = useDeployFreshness();

  if (!stale) return null;

  return (
    <div
      className="mb-4 rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-950 shadow-sm"
      role="status"
    >
      <p className="font-semibold">A newer version is available</p>
      <p className="mt-1 text-xs sm:text-sm opacity-90">
        This tab is running build <code className="bg-white/70 px-1 rounded">{localSha}</code>
        {remoteSha ? (
          <>
            {' '}
            but the server has <code className="bg-white/70 px-1 rounded">{remoteSha}</code>.
          </>
        ) : (
          '.'
        )}{' '}
        Refresh to load Wealth Analytics, fiscal-month Transactions, signup approval, and other recent changes.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700"
        >
          Refresh now
        </button>
        <a
          href={getCanonicalAppUrl()}
          className="inline-flex items-center rounded-lg border border-sky-400 bg-white px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-100"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open {getCanonicalAppUrl().replace('https://', '')}
        </a>
        {typeof window !== 'undefined' &&
        window.location.hostname === 'finova-hussein.netlify.app' &&
        remoteSha !== localSha ? (
          <a
            href={VERCEL_MIRROR_APP_URL}
            className="inline-flex items-center rounded-lg border border-sky-400 bg-white px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-100"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Vercel mirror (latest)
          </a>
        ) : null}
      </div>
    </div>
  );
};

export default DeployFreshnessBanner;
