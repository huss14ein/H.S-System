import React, { useState } from 'react';
import { useAI } from '../context/AiContext';

type Variant = 'centered' | 'banner';

const shellBase =
    'rounded-md border border-amber-200 bg-amber-50/90 p-4 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100';

/**
 * Shown when the AI proxy health check finished and no server provider keys were found, or the proxy was unreachable.
 * AI keys are read only inside Netlify Functions from Site → Environment variables (never exposed to the browser).
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
      ? 'No AI provider keys in Netlify for this site'
      : 'Cannot reach the AI proxy');

  const detail =
    aiUnavailableReason === 'no_keys' ? (
      <>
        Add at least one key under{' '}
        <strong>Netlify → Site configuration → Environment variables</strong> (for example{' '}
        <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">GEMINI_API_KEY</code>,{' '}
        <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">ANTHROPIC_API_KEY</code>,{' '}
        <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">OPENAI_API_KEY</code>, or{' '}
        <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">GROK_API_KEY</code>
        ). Redeploy so functions reload. Keys exist only in Netlify&apos;s server-side environment for the proxy—never in the browser bundle.
      </>
    ) : (
      <>
        The browser must talk to your Netlify deployment&apos;s function URL so the proxy can use{' '}
        <strong>Site → Environment variables</strong> on the server. After your site or dev session exposes functions with those variables, use{' '}
        <strong>Retry connection check</strong>.
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
