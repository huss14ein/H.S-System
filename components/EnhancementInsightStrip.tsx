import React from 'react';
import { ExclamationTriangleIcon } from './icons/ExclamationTriangleIcon';
import type { GoalConflict } from '../services/goalConflictDetection';
import type { BudgetDriftRow } from '../services/budgetDrift';
import type { LifestyleGuardrailHit } from '../services/lifestyleGuardrails';
import type { CapitalDeploymentAnswer } from '../services/capitalDeploymentOrchestrator';

type Props = {
  capitalDeployment?: CapitalDeploymentAnswer | null;
  goalConflicts?: GoalConflict[];
  budgetDrift?: BudgetDriftRow[];
  lifestyleHits?: LifestyleGuardrailHit[];
  compact?: boolean;
};

const EnhancementInsightStrip: React.FC<Props> = ({
  capitalDeployment,
  goalConflicts = [],
  budgetDrift = [],
  lifestyleHits = [],
  compact,
}) => {
  const hasContent =
    (capitalDeployment && !capitalDeployment.canInvest) ||
    goalConflicts.length > 0 ||
    budgetDrift.length > 0 ||
    lifestyleHits.length > 0;
  if (!hasContent) return null;

  return (
    <div className={`space-y-2 ${compact ? 'text-xs' : 'text-sm'}`}>
      {capitalDeployment && !capitalDeployment.canInvest && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
          <span className="font-medium">Capital gates: </span>
          {capitalDeployment.reasons.slice(0, 2).join(' ')}
        </div>
      )}
      {goalConflicts.map((c) => (
        <div
          key={c.id}
          className={`rounded-lg border px-3 py-2 flex gap-2 items-start ${
            c.severity === 'critical' ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-900'
          }`}
        >
          <ExclamationTriangleIcon className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{c.message}</span>
        </div>
      ))}
      {budgetDrift.slice(0, 3).map((d) => (
        <div key={d.category} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-800">
          <span className="font-medium">{d.category}</span> spend {d.driftPct > 0 ? '+' : ''}
          {d.driftPct.toFixed(0)}% vs 3-mo baseline ({Math.round(d.currentSar)} vs {Math.round(d.baselineSar)} SAR)
        </div>
      ))}
      {lifestyleHits.map((h) => (
        <div
          key={h.code}
          className={`rounded-lg border px-3 py-2 ${
            h.severity === 'block' ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-900'
          }`}
        >
          {h.message}
        </div>
      ))}
    </div>
  );
};

export default EnhancementInsightStrip;
