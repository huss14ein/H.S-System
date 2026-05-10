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
      ? 'AI proxy is up — no provider key on the server'
      : 'Cannot reach the AI proxy from this browser');

  const detail =
    aiUnavailableReason === 'no_keys' ? (
      <>
        Add at least one server env var (Netlify or local <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">.env</code>):{' '}
        <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">GEMINI_API_KEY</code>,{' '}
        <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">OPENAI_API_KEY</code>,{' '}
        <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">ANTHROPIC_API_KEY</code>, or{' '}
        <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">GROK_API_KEY</code>. Restart the dev server after changing <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">.env</code>.
      </>
    ) : (
      <>
        Confirm the app is served with <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">npm run dev</code> (Vite +{' '}
        <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">@netlify/vite-plugin</code> in{' '}
        <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">vite.config.ts</code> so <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">/api/gemini-proxy</code> exists). If you
        use another host/port, add its full origin to <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">ALLOWED_ORIGINS</code> in Netlify (or{' '}
        <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">.env</code> for local functions). Try <strong>Retry</strong> after fixing.
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
