import React, { useMemo } from 'react';
import { ExclamationTriangleIcon } from './icons/ExclamationTriangleIcon';
import { ArrowTrendingUpIcon } from './icons/ArrowTrendingUpIcon';
import { ChartBarIcon } from './icons/ChartBarIcon';
import type { GoalConflict } from '../services/goalConflictDetection';
import type { BudgetDriftRow } from '../services/budgetDrift';
import type { LifestyleGuardrailHit } from '../services/lifestyleGuardrails';
import type { CapitalDeploymentAnswer } from '../services/capitalDeploymentOrchestrator';

type Props = {
  /** Omit on Dashboard when the dedicated “Can I invest?” card is shown. */
  capitalDeployment?: CapitalDeploymentAnswer | null;
  goalConflicts?: GoalConflict[];
  budgetDrift?: BudgetDriftRow[];
  lifestyleHits?: LifestyleGuardrailHit[];
  compact?: boolean;
};

type InsightRow = {
  id: string;
  tone: 'critical' | 'warning' | 'neutral';
  icon: React.ReactNode;
  title: string;
  body: string;
};

function toneClasses(tone: InsightRow['tone']): { row: string; icon: string } {
  if (tone === 'critical') {
    return {
      row: 'border-l-rose-500 bg-rose-50/80',
      icon: 'bg-rose-100 text-rose-700 ring-rose-200/80',
    };
  }
  if (tone === 'warning') {
    return {
      row: 'border-l-amber-500 bg-amber-50/80',
      icon: 'bg-amber-100 text-amber-800 ring-amber-200/80',
    };
  }
  return {
    row: 'border-l-slate-400 bg-slate-50/90',
    icon: 'bg-slate-100 text-slate-600 ring-slate-200/80',
  };
}

const EnhancementInsightStrip: React.FC<Props> = ({
  capitalDeployment,
  goalConflicts = [],
  budgetDrift = [],
  lifestyleHits = [],
  compact,
}) => {
  const rows = useMemo((): InsightRow[] => {
    const list: InsightRow[] = [];
    if (capitalDeployment && !capitalDeployment.canInvest) {
      list.push({
        id: 'capital-gates',
        tone: 'warning',
        icon: <ExclamationTriangleIcon className="h-4 w-4" />,
        title: 'Capital gates',
        body: capitalDeployment.reasons.slice(0, 2).join(' '),
      });
    }
    goalConflicts.forEach((c) => {
      list.push({
        id: c.id,
        tone: c.severity === 'critical' ? 'critical' : 'warning',
        icon: <ExclamationTriangleIcon className="h-4 w-4" />,
        title: 'Goal funding',
        body: c.message,
      });
    });
    budgetDrift.forEach((d) => {
      list.push({
        id: `drift-${d.category}`,
        tone: Math.abs(d.driftPct) >= 50 ? 'warning' : 'neutral',
        icon: <ChartBarIcon className="h-4 w-4" />,
        title: d.category,
        body: `Spend ${d.driftPct > 0 ? '+' : ''}${d.driftPct.toFixed(0)}% vs 3‑month baseline (${Math.round(d.currentSar).toLocaleString()} vs ${Math.round(d.baselineSar).toLocaleString()} SAR)`,
      });
    });
    lifestyleHits.forEach((h) => {
      list.push({
        id: h.code,
        tone: h.severity === 'block' ? 'critical' : 'warning',
        icon: <ArrowTrendingUpIcon className="h-4 w-4" />,
        title: 'Lifestyle guardrail',
        body: h.message,
      });
    });
    return list;
  }, [capitalDeployment, goalConflicts, budgetDrift, lifestyleHits]);

  if (rows.length === 0) return null;

  return (
    <section
      className={`mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ${compact ? '' : ''}`}
      aria-label="Financial insights needing attention"
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/80 px-4 py-2.5">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">Insights</h3>
        <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-slate-200/80 px-1.5 text-[10px] font-bold text-slate-700 tabular-nums">
          {rows.length}
        </span>
      </div>
      <ul className="divide-y divide-slate-100">
        {rows.map((row) => {
          const tone = toneClasses(row.tone);
          return (
            <li
              key={row.id}
              className={`flex gap-3 border-l-[3px] px-4 py-3 ${tone.row} ${compact ? 'text-xs' : 'text-sm'}`}
            >
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ${tone.icon}`}
              >
                {row.icon}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 leading-none mb-1">
                  {row.title}
                </p>
                <p className="text-slate-800 leading-snug">{row.body}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default EnhancementInsightStrip;
