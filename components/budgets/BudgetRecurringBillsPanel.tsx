import React from 'react';
import SectionCard from '../SectionCard';
import type { RecurringBillPattern } from '../../services/hybridBudgetCategorization';

type Props = {
  bills: RecurringBillPattern[];
  isOpen: boolean;
  onOpen: () => void;
  formatCurrencyString: (value: number, opts?: { digits?: number }) => string;
};

const BudgetRecurringBillsPanel: React.FC<Props> = ({ bills, isOpen, onOpen, formatCurrencyString }) => (
  <SectionCard
    title="Recurring bills & price benchmarks"
    collapsible
    collapsibleSummary="Bills, benchmarks (expand to load)"
    defaultExpanded={false}
    onExpandedChange={(open) => {
      if (open) onOpen();
    }}
  >
    {!isOpen ? (
      <p className="text-sm text-slate-500">Expand to detect recurring merchants and benchmark comparisons.</p>
    ) : bills.length > 0 ? (
      <>
        <ul className="space-y-2 text-sm">
          {bills.slice(0, 8).map((bill, i) => (
            <li
              key={`${bill.merchant}-${i}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/50 p-2"
            >
              <span className="font-medium text-slate-800">{bill.merchant}</span>
              <span className="text-slate-600">
                {formatCurrencyString(bill.typicalAmount, { digits: 0 })} · {bill.frequency}
              </span>
              {bill.benchmarkComparison && (
                <span className="text-xs text-slate-500 w-full mt-0.5">
                  Market avg: {formatCurrencyString(bill.benchmarkComparison.marketAverage, { digits: 0 })} ·{' '}
                  {bill.benchmarkComparison.recommendation ??
                    `You pay ${bill.benchmarkComparison.percentile}th %ile`}
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-500">
          Categories from EXPENSE_CATEGORIES; benchmarks from hybrid AI/local classification.
        </p>
      </>
    ) : (
      <p className="text-sm text-slate-500">No recurring bill patterns detected yet (need at least 2 similar expenses).</p>
    )}
  </SectionCard>
);

export default React.memo(BudgetRecurringBillsPanel);
