import React from 'react';
import type { BudgetUtilizationLabel } from '../services/budgetCardVisuals';

const SIZE = 100;
const STROKE = 6;
const R = (SIZE - STROKE) / 2 - 2;
const C = 2 * Math.PI * R;

function strokeColor(u: BudgetUtilizationLabel): string {
    switch (u) {
        case 'Critical':
            return '#ef4444';
        case 'Watch':
            return '#f59e0b';
        default:
            return '#10b981';
    }
}

/**
 * Compact circular gauge for budget utilization (no SVG blur filters — lighter on main thread).
 */
const BudgetUsageDial: React.FC<{
    percentage: number;
    utilizationLabel: BudgetUtilizationLabel;
    size?: number;
    className?: string;
}> = ({ percentage, utilizationLabel, size = 58, className = '' }) => {
    const pct = Number.isFinite(percentage) ? percentage : 0;
    const arcFrac = Math.min(Math.max(pct / 100, 0), 1);
    const offset = C * (1 - arcFrac);
    const stroke = strokeColor(utilizationLabel);

    return (
        <div
            className={`relative shrink-0 flex items-center justify-center ${className}`}
            style={{ width: size, height: size }}
            aria-hidden
        >
            <svg width={size} height={size} viewBox={`0 0 ${SIZE} ${SIZE}`} className="select-none">
                <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" strokeWidth={STROKE} className="text-slate-200" stroke="currentColor" />
                <circle
                    cx={SIZE / 2}
                    cy={SIZE / 2}
                    r={R}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={STROKE}
                    strokeLinecap="round"
                    strokeDasharray={C}
                    strokeDashoffset={offset}
                    transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
                    className="transition-[stroke-dashoffset] duration-500 ease-out"
                />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-[11px] font-bold leading-none text-slate-800 tabular-nums">
                    {Math.min(Math.round(pct), 999)}%
                </span>
            </div>
        </div>
    );
};

export default BudgetUsageDial;
