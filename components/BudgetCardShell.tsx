import React from 'react';
import {
    budgetCardOrbBottom,
    budgetCardOrbTop,
    budgetTierTopHairline,
    type BudgetTierVisual,
    type BudgetUtilizationLabel,
} from '../services/budgetCardVisuals';

/** Frosted shell with mesh orbs + tier hairline — wrap card body for a consistent “premium” surface. */
const BudgetCardShell: React.FC<{
    utilizationLabel: BudgetUtilizationLabel;
    budgetTier: BudgetTierVisual;
    children: React.ReactNode;
}> = ({ utilizationLabel, budgetTier, children }) => {
    return (
        <div className="relative overflow-hidden rounded-3xl border border-white/75 bg-gradient-to-br from-white/70 via-white/50 to-slate-50/40 backdrop-blur-md shadow-[0_12px_42px_-14px_rgba(15,23,42,0.22)] ring-1 ring-inset ring-white/70 transition-[transform,box-shadow,background] duration-300 group-hover:from-white/85 group-hover:via-white/65 group-hover:shadow-[0_22px_56px_-16px_rgba(15,23,42,0.28)]">
            <div
                className={`pointer-events-none absolute -right-14 -top-20 h-48 w-48 rounded-full blur-3xl ${budgetCardOrbTop(utilizationLabel)}`}
            />
            <div
                className={`pointer-events-none absolute -bottom-12 -left-14 h-44 w-44 rounded-full blur-2xl ${budgetCardOrbBottom(utilizationLabel)}`}
            />
            <div
                className={`pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r opacity-[0.92] ${budgetTierTopHairline(budgetTier)}`}
            />
            <div className="relative z-[1] p-5 sm:p-6">{children}</div>
        </div>
    );
};

export default BudgetCardShell;
