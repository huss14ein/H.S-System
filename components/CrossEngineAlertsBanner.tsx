import React, { useEffect, useState } from 'react';
import type { Page } from '../types';
import { BoltIcon } from './icons/BoltIcon';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { ChevronUpIcon } from './icons/ChevronUpIcon';
import { ClipboardDocumentListIcon } from './icons/ClipboardDocumentListIcon';
import { ExclamationTriangleIcon } from './icons/ExclamationTriangleIcon';
import type { CrossEngineAnalysis } from '../services/engineIntegration';

export interface CrossEngineAlertsBannerProps {
  /** Default: collapsible strip at top of page. `embedded` = always-open lists (e.g. inside a section card). */
  variant?: 'collapsible' | 'embedded';
  ready: boolean;
  analysis: CrossEngineAnalysis | null | undefined;
  actionQueue: Array<{
    action: string;
    priority: number;
    category?: string;
    details: string;
    links?: Array<{ label: string; page: Page; action?: string }>;
  }>;
  setActivePage: (page: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
}

/**
 * Shared cross-engine alerts + prioritized actions strip for global placement (Layout).
 * Mirrors Dashboard interactive patterns so alerts are actionable on every page.
 */
const CrossEngineAlertsBanner: React.FC<CrossEngineAlertsBannerProps> = ({
  variant = 'collapsible',
  ready,
  analysis,
  actionQueue,
  setActivePage,
  triggerPageAction,
}) => {
  const [expanded, setExpanded] = useState(variant === 'embedded');
  const [openAlertIdx, setOpenAlertIdx] = useState<number | null>(null);
  const [openActionIdx, setOpenActionIdx] = useState<number | null>(null);

  const alerts = analysis?.alerts ?? [];
  useEffect(() => {
    setOpenAlertIdx(null);
    setOpenActionIdx(null);
  }, [analysis, actionQueue]);
  const hasAlerts = alerts.length > 0;
  const hasActions = actionQueue.length > 0;
  if (!ready || (!hasAlerts && !hasActions)) return null;

  const criticalCount = alerts.filter((a) => a.severity === 'critical').length;
  const warningCount = alerts.filter((a) => a.severity === 'warning').length;

  const innerContent = (
        <div className={`${variant === 'embedded' ? '' : 'border-t border-amber-200/80 px-4 pb-4 pt-1'} space-y-4`}>
          {hasAlerts && (
            <div className={`rounded-xl border border-amber-200/80 bg-amber-50/90 p-3 shadow-inner ${variant === 'embedded' ? '' : ''}`}>
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-900/90 mb-2 flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-amber-500 animate-pulse motion-reduce:animate-none" aria-hidden />
                Alerts
              </p>
              <ul className="space-y-2">
                {alerts.slice(0, 5).map((a, i) => {
                  const open = openAlertIdx === i;
                  const bar =
                    a.severity === 'critical'
                      ? 'border-l-rose-500 bg-rose-50/40'
                      : a.severity === 'warning'
                        ? 'border-l-amber-500 bg-amber-50/50'
                        : 'border-l-sky-400 bg-white';
                  return (
                    <li key={i} className={`rounded-lg border border-amber-200/60 shadow-sm overflow-hidden border-l-4 ${bar}`}>
                      <div className="flex items-start gap-2.5 px-3 py-2.5 text-sm font-medium text-slate-900">
                        <ExclamationTriangleIcon
                          className={`h-5 w-5 shrink-0 ${a.severity === 'critical' ? 'text-rose-600' : 'text-amber-600'}`}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1 leading-snug">{a.message}</span>
                      </div>
                      {a.suggestedAction && (
                        <div className="px-3 pb-2 text-xs text-amber-950/90 border-t border-amber-100/80 bg-white/60">
                          <p className="pt-2">
                            <strong className="font-semibold text-slate-800">Suggested:</strong> {a.suggestedAction}
                          </p>
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-2 px-3 pb-2.5 pt-1 border-t border-amber-100/60 bg-white/70">
                        {(a.links ?? []).map((lnk) => (
                          <button
                            key={`${lnk.label}-${lnk.page}-${i}`}
                            type="button"
                            onClick={() => {
                              if (lnk.action && triggerPageAction) triggerPageAction(lnk.page, lnk.action);
                              else setActivePage(lnk.page);
                            }}
                            className="text-xs font-semibold text-primary hover:underline"
                          >
                            {lnk.label} →
                          </button>
                        ))}
                        <button
                          type="button"
                          className="text-xs text-slate-600 hover:text-slate-900 ml-auto"
                          onClick={() => setOpenAlertIdx(open ? null : i)}
                          aria-expanded={open}
                        >
                          {open ? 'Hide details' : 'Details'}
                        </button>
                      </div>
                      {open && a.relatedMetrics && Object.keys(a.relatedMetrics).length > 0 && (
                        <div className="px-3 pb-2.5 text-[11px] text-slate-600 font-mono bg-slate-50/90 border-t border-slate-100">
                          {Object.entries(a.relatedMetrics).map(([k, v]) => (
                            <span key={k} className="mr-3">
                              {k}: {typeof v === 'number' ? v.toFixed(2) : v}
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {hasActions && (
            <div className="rounded-xl border border-sky-200/80 bg-sky-50/90 p-3 shadow-inner">
              <p className="text-[11px] font-bold uppercase tracking-wider text-sky-900/90 mb-2 flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-sky-500" aria-hidden />
                Prioritized actions
              </p>
              <ul className="space-y-2">
                {actionQueue.slice(0, 6).map((item, i) => {
                  const p = Math.round(item.priority);
                  const priorityClass =
                    p <= 2
                      ? 'border-red-300 bg-red-100 text-red-900'
                      : p <= 4
                        ? 'border-amber-300 bg-amber-100 text-amber-950'
                        : 'border-slate-200 bg-slate-100 text-slate-800';
                  const open = openActionIdx === i;
                  return (
                    <li key={i} className="rounded-lg border border-sky-200/70 bg-white/90 text-sm text-slate-800 shadow-sm overflow-hidden">
                      <div className="flex items-start justify-between gap-3 px-3 py-2.5">
                        <span className="min-w-0 flex-1 leading-snug font-medium">{item.action}</span>
                        <span
                          className={`shrink-0 inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold tabular-nums ${priorityClass}`}
                          title={`Priority ${p} (lower = more urgent)`}
                        >
                          P{p}
                        </span>
                      </div>
                      {item.details && (
                        <div className="px-3 pb-2 text-xs text-slate-600 border-t border-sky-100 bg-sky-50/40">
                          <p className="pt-1.5">{item.details}</p>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2 px-3 pb-2.5 items-center border-t border-sky-100/70 bg-white/70">
                        {(item.links ?? []).map((lnk) => (
                          <button
                            key={`${lnk.label}-${lnk.page}-a-${i}`}
                            type="button"
                            onClick={() => {
                              if (lnk.action && triggerPageAction) triggerPageAction(lnk.page, lnk.action);
                              else setActivePage(lnk.page);
                            }}
                            className="text-xs font-semibold text-primary hover:underline"
                          >
                            {lnk.label} →
                          </button>
                        ))}
                        <button
                          type="button"
                          className="text-xs text-slate-600 hover:text-slate-900 ml-auto"
                          onClick={() => setOpenActionIdx(open ? null : i)}
                        >
                          {open ? 'Hide' : 'More'}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
  );

  if (variant === 'embedded') {
    return <div className="space-y-3">{innerContent}</div>;
  }

  return (
    <div
      className="mb-4 rounded-2xl border border-amber-300/90 bg-gradient-to-br from-amber-50/95 via-white to-orange-50/50 shadow-sm ring-1 ring-amber-200/60"
      role="region"
      aria-label="Cross-engine alerts and actions"
    >
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left min-w-0"
        aria-expanded={expanded}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-md shadow-amber-500/25">
          <BoltIcon className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">
            Alerts & suggested actions
            {!expanded && (
              <span className="font-normal text-slate-600">
                {' '}
                · {hasAlerts ? `${alerts.length} alert${alerts.length === 1 ? '' : 's'}` : 'No alerts'}
                {hasActions ? ` · ${actionQueue.length} action${actionQueue.length === 1 ? '' : 's'}` : ''}
              </span>
            )}
          </p>
          <p className="text-xs text-slate-600 truncate">
            {criticalCount > 0 && (
              <span className="font-medium text-rose-800">{criticalCount} critical</span>
            )}
            {criticalCount > 0 && warningCount > 0 ? ' · ' : ''}
            {warningCount > 0 && <span className="font-medium text-amber-900">{warningCount} warning</span>}
            {!criticalCount && !warningCount && hasAlerts && <span>Review signals from your engines</span>}
            {!hasAlerts && hasActions && <span>Open to jump to Budgets, Plan, Investments, and more</span>}
          </p>
        </div>
        <span className="flex shrink-0 flex-wrap items-center gap-2">
          {hasAlerts && (
            <span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-bold uppercase text-rose-900">
              <ExclamationTriangleIcon className="h-3 w-3 text-rose-600" aria-hidden />
              {alerts.length}
            </span>
          )}
          {hasActions && (
            <span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-bold uppercase text-sky-900">
              <ClipboardDocumentListIcon className="h-3 w-3 text-sky-600" aria-hidden />
              {actionQueue.length}
            </span>
          )}
          {expanded ? <ChevronUpIcon className="h-5 w-5 text-slate-500" /> : <ChevronDownIcon className="h-5 w-5 text-slate-500" />}
        </span>
      </button>

      {expanded && innerContent}
    </div>
  );
};

export default CrossEngineAlertsBanner;
