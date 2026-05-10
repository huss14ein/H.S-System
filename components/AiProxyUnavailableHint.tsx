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
          <strong>Local</strong> default is <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">npm run dev</code> → <strong>Netlify Dev</strong>, which injects{' '}
          <strong>the same keys as your linked Netlify site</strong> after <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">netlify link</code>.{' '}
          Project <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">.env</code> /{' '}
          <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">.env.local</code> still merge on top. If you use{' '}
          <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">npm run dev:vite</code> only, run{' '}
          <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">netlify env:pull</code> or copy keys by hand. Restart dev after env changes.
        </span>
      </>
    ) : (
      <>
        Run <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">npm run dev</code> from the repo root — it starts{' '}
        <strong>Netlify Dev</strong> (<code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">netlify.toml</code> →{' '}
        <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">npm run dev:vite</code>) so Vite +{' '}
        <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">@netlify/vite-plugin</code> serves{' '}
        <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">/api/gemini-proxy</code> and injects{' '}
        <strong>your linked Netlify site&apos;s environment variables</strong> into functions (run <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">netlify link</code> once per clone).
        Plain Vite only: <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">npm run dev:vite</code> or{' '}
        <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">FORCE_VITE_DEV=1 npm run dev</code> — then use{' '}
        <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">netlify env:pull</code> or copy keys into <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">.env</code>.
        LAN / private IPs are allowed by default for CORS. Click <strong>Retry</strong> after the dev server is up.
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
