import React, { useState } from 'react';
import { useAI } from '../context/AiContext';

type Variant = 'centered' | 'banner';

const shellBase =
    'rounded-md border border-amber-200 bg-amber-50/90 p-4 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100';

/**
 * Shown when the AI proxy health check finished and no server provider keys were found, or the proxy was unreachable.
 * Prefer this over hard-coded setup copy so messaging stays in sync with AiContext.
 */
export const AiProxyUnavailableHint: React.FC<{
  variant?: Variant;
  className?: string;
  title?: string;
}> = ({ variant = 'centered', className = '', title }) => {
  const { isAiAvailable, aiHealthChecked, refreshAiHealth, aiUnavailableReason } = useAI();
  const [busy, setBusy] = useState(false);

  if (!aiHealthChecked || isAiAvailable) return null;

  const headline =
    title ??
    (aiUnavailableReason === 'no_keys'
      ? 'AI proxy is reachable — no provider API keys visible (check Netlify env or local .env)'
      : 'Cannot reach the AI proxy from this browser');

  const detail =
    aiUnavailableReason === 'no_keys' ? (
      <>
        <strong>Production</strong> reads AI keys from{' '}
        <strong>Netlify → Site configuration → Environment variables</strong> (e.g.{' '}
        <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">GEMINI_API_KEY</code>,{' '}
        <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">OPENAI_API_KEY</code>, etc.) — redeploy after changes.
        <br />
        <span className="mt-1 inline-block">
          <strong>Local</strong> <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">npm run dev</code> loads the same variable names from the project root{' '}
          <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">.env</code> /{' '}
          <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">.env.local</code> (Netlify does not push dashboard env into plain Vite automatically). Sync from your site:{' '}
          <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">netlify link</code> then{' '}
          <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">netlify env:pull</code>, or run{' '}
          <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">netlify dev</code> which injects site env into functions. Restart dev after editing env files.
        </span>
      </>
    ) : (
      <>
        Use <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">npm run dev</code> from the repo root so Vite +{' '}
        <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">@netlify/vite-plugin</code> exposes{' '}
        <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">/api/gemini-proxy</code>. If the browser origin is not localhost (e.g. LAN IP or custom port), add that full origin to{' '}
        <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">ALLOWED_ORIGINS</code> in Netlify <strong>or</strong> in <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">.env</code> for local functions. Click{' '}
        <strong>Retry</strong> after fixing.
      </>
    );

  const wrap = variant === 'banner' ? 'mb-6' : 'mt-2 text-center';
  const align = variant === 'banner' ? 'text-left' : 'text-center';

  return (
    <div className={`${shellBase} ${align} ${wrap} ${className}`} role="alert">
      <p className="font-semibold">{headline}</p>
      <p className="text-sm mt-1 text-amber-950/90 dark:text-amber-100/90">{detail}</p>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void refreshAiHealth().finally(() => setBusy(false));
        }}
        className="mt-3 px-3 py-1.5 text-sm font-medium rounded-lg bg-amber-100 text-amber-950 hover:bg-amber-200 disabled:opacity-60 dark:bg-amber-900/60 dark:text-amber-50 dark:hover:bg-amber-900"
      >
        {busy ? 'Checking…' : 'Retry connection check'}
      </button>
    </div>
  );
};

export default AiProxyUnavailableHint;
