import React from 'react';
import type { AiActionCard, AiActionKind, AiActionSeverity } from '../services/aiActionCards';
import { dispatchAiActionCard } from '../services/aiActionNavigate';

const kindLabel: Record<AiActionKind, string> = {
  wealth: 'Wealth',
  goal: 'Goal',
  trade: 'Trade',
  budget: 'Budget',
  debt: 'Debt',
  recovery: 'Recovery',
  zakat: 'Zakat',
  ops: 'Ops',
};

const severityShell: Record<AiActionSeverity, string> = {
  info: 'border-l-sky-500 bg-sky-50/80',
  watch: 'border-l-amber-500 bg-amber-50/80',
  urgent: 'border-l-rose-500 bg-rose-50/80',
};

function fmtImpact(n?: number): string | null {
  if (n == null || !Number.isFinite(n) || n === 0) return null;
  const abs = Math.abs(Math.round(n)).toLocaleString();
  return n < 0 ? `−${abs} SAR` : `${abs} SAR`;
}

export const AiActionCardsPanel: React.FC<{
  cards: AiActionCard[];
  title?: string;
  className?: string;
}> = ({ cards, title = 'Recommendations', className = '' }) => {
  if (!cards?.length) return null;
  return (
    <div className={`mt-4 space-y-2 ${className}`}>
      <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
      <ul className="space-y-2">
        {cards.map((card) => {
          const impact = fmtImpact(card.impactSar);
          const ctaLabel = card.cta.label || `Open ${card.cta.page}`;
          return (
            <li
              key={card.id}
              className={`rounded-lg border border-slate-200 border-l-4 p-3 ${severityShell[card.severity]}`}
            >
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-600 bg-white/70 px-1.5 py-0.5 rounded">
                  {kindLabel[card.kind]}
                </span>
                {card.rulesBased ? (
                  <span className="text-[10px] uppercase tracking-wide text-slate-500">Rules-based</span>
                ) : null}
                {impact ? <span className="text-xs font-medium text-slate-700">Impact ~{impact}</span> : null}
              </div>
              <p className="font-semibold text-slate-900 text-sm">{card.title}</p>
              <p className="text-xs text-slate-600 mt-0.5 whitespace-pre-wrap">{card.rationale}</p>
              <button
                type="button"
                onClick={() => dispatchAiActionCard(card)}
                className="mt-2 inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-md bg-slate-900 text-white hover:bg-slate-700"
              >
                {ctaLabel}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default AiActionCardsPanel;
