import React, { useEffect, useState } from 'react';
import type { BudgetMonthOpenHint } from '../services/budgetMonthOpenAssistant';
import { budgetMonthOpenDismissKey } from '../services/budgetMonthOpenAssistant';
import type { FinancialMonthKey } from '../utils/financialMonth';

type Props = {
  hints: BudgetMonthOpenHint[];
  monthKey: FinancialMonthKey;
  onCopyLastMonth?: () => void;
  onReviewDrift?: () => void;
};

const BudgetMonthOpenBanner: React.FC<Props> = ({ hints, monthKey, onCopyLastMonth, onReviewDrift }) => {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(budgetMonthOpenDismissKey(monthKey)) === '1');
    } catch {
      setDismissed(false);
    }
  }, [monthKey.year, monthKey.month]);

  if (!hints.length || dismissed) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(budgetMonthOpenDismissKey(monthKey), '1');
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  return (
    <section
      className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50/90 px-4 py-3 text-sm text-indigo-950"
      aria-label="Month-open budget assistant"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">Month-open checklist</p>
          <ul className="mt-2 space-y-1.5 list-disc pl-5">
            {hints.map((h) => (
              <li key={h.id}>
                {h.message}
                {h.action === 'copy-last-month' && onCopyLastMonth ? (
                  <>
                    {' '}
                    <button type="button" className="font-semibold underline" onClick={onCopyLastMonth}>
                      Copy last month
                    </button>
                  </>
                ) : null}
                {h.action === 'review-drift' && onReviewDrift ? (
                  <>
                    {' '}
                    <button type="button" className="font-semibold underline" onClick={onReviewDrift}>
                      Review categories
                    </button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
        <button
          type="button"
          className="shrink-0 text-xs font-medium text-indigo-700 hover:underline"
          onClick={dismiss}
        >
          Dismiss
        </button>
      </div>
    </section>
  );
};

export default BudgetMonthOpenBanner;
