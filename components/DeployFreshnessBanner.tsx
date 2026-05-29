import React from 'react';
import { useDeployFreshness } from '../hooks/useDeployFreshness';

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
        Refresh to load Wealth Analytics and other recent changes.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-2 inline-flex items-center rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700"
      >
        Refresh now
      </button>
    </div>
  );
};

export default DeployFreshnessBanner;
