import React, { useState } from 'react';
import { useAI, type AiUnavailableReason } from '../context/AiContext';

type Variant = 'centered' | 'banner';

const shellBase =
  'rounded-md border border-amber-200 bg-amber-50/90 p-4 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100';

function defaultHeadline(reason: AiUnavailableReason): string {
  switch (reason) {
    case 'no_keys':
      return 'No AI provider keys in Netlify for this site';
    case 'origin_blocked':
      return 'This browser origin is blocked by the AI proxy';
    case 'spa_shell':
      return 'The AI proxy URL returned the web app instead of the function';
    case 'network':
    default:
      return 'Cannot reach the AI proxy';
  }
}

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

  const headline = title ?? defaultHeadline(aiUnavailableReason);

  const detail = (() => {
    switch (aiUnavailableReason) {
      case 'no_keys':
        return (
          <>
            Add at least one key under{' '}
            <strong>Netlify → Site configuration → Environment variables</strong> (for example{' '}
            <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">GEMINI_API_KEY</code>,{' '}
            <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">ANTHROPIC_API_KEY</code>,{' '}
            <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">OPENAI_API_KEY</code>, or{' '}
            <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">GROK_API_KEY</code>
            ). Redeploy so functions reload. Keys exist only in Netlify&apos;s server-side environment for the proxy—never in the browser bundle.
          </>
        );
      case 'origin_blocked': {
        const origin =
          typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'your app origin';
        return (
          <>
            The AI proxy blocked <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">{origin}</code>{' '}
            (HTTP 403). Redeploy the latest build, then <strong>Retry connection check</strong>. If it still fails, set{' '}
            <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">ALLOWED_ORIGINS</code> to that URL under{' '}
            <strong>Site → Environment variables</strong> (scope: All or Functions) and ensure{' '}
            <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">GEMINI_API_KEY</code> (or another provider
            key) is present for Functions.
          </>
        );
      }
      case 'spa_shell':
        return (
          <>
            Load the app from a host that serves Netlify Functions at{' '}
            <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">/api/gemini-proxy</code>, or set build env{' '}
            <code className="text-xs bg-amber-100 px-1 rounded dark:bg-amber-900/50">VITE_AI_PROXY_EXTRA_ORIGIN</code> to your deployed site URL (https), rebuild, then Retry.
          </>
        );
      case 'network':
      default:
        return (
          <>
            The health check could not get a JSON response from the proxy (offline, wrong host, or blocked request). If keys are set in Netlify, confirm you are on the same deployment and use{' '}
            <strong>Retry connection check</strong>.
          </>
        );
    }
  })();

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
