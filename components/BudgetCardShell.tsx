import React from 'react';
import {
    budgetCardStatusTint,
    budgetTierTopHairline,
    type BudgetTierVisual,
    type BudgetUtilizationLabel,
} from '../services/budgetCardVisuals';

/** Clean card shell — status hairline, no blur orbs (faster paint). */
const BudgetCardShell: React.FC<{
    utilizationLabel: BudgetUtilizationLabel;
    budgetTier: BudgetTierVisual;
    children: React.ReactNode;
}> = ({ utilizationLabel, budgetTier: _budgetTier, children }) => {
    return (
        <div
            className={`relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow duration-200 group-hover:shadow-md ${budgetCardStatusTint(utilizationLabel)}`}
        >
            <div
                className={`pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${budgetTierTopHairline(utilizationLabel)}`}
                aria-hidden
            />
            <div className="relative z-[1] flex h-full min-h-0 flex-1 flex-col p-5 sm:p-6">{children}</div>
        </div>
    );
};

export default BudgetCardShell;
