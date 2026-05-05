import React from 'react';
import type { BudgetUtilizationLabel } from '../services/budgetCardVisuals';

const SIZE = 100;
const STROKE = 7;
const R = (SIZE - STROKE) / 2 - 2;
const C = 2 * Math.PI * R;

function dialIds(u: BudgetUtilizationLabel): { grad: string; glow: string } {
    switch (u) {
        case 'Critical':
            return { grad: 'url(#budgetDialRose)', glow: 'url(#budgetDialGlowRose)' };
        case 'Watch':
            return { grad: 'url(#budgetDialAmber)', glow: 'url(#budgetDialGlowAmber)' };
        default:
            return { grad: 'url(#budgetDialEmerald)', glow: 'url(#budgetDialGlowEmerald)' };
    }
}

/**
 * Compact circular gauge for budget utilization (same semantics as the primary progress bar).
 */
const BudgetUsageDial: React.FC<{
    percentage: number;
    utilizationLabel: BudgetUtilizationLabel;
    /** Outer pixel width/height */
    size?: number;
    className?: string;
}> = ({ percentage, utilizationLabel, size = 58, className = '' }) => {
    const pct = Number.isFinite(percentage) ? percentage : 0;
    const arcFrac = Math.min(Math.max(pct / 100, 0), 1);
    const offset = C * (1 - arcFrac);
    const { grad, glow } = dialIds(utilizationLabel);

    return (
        <div
            className={`relative shrink-0 flex items-center justify-center ${className}`}
            style={{ width: size, height: size }}
            aria-hidden
        >
            <svg width={size} height={size} viewBox={`0 0 ${SIZE} ${SIZE}`} className="select-none">
                <defs>
                    <linearGradient id="budgetDialEmerald" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#10b981" />
                        <stop offset="100%" stopColor="#14b8a6" />
                    </linearGradient>
                    <linearGradient id="budgetDialAmber" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#fbbf24" />
                        <stop offset="100%" stopColor="#f97316" />
                    </linearGradient>
                    <linearGradient id="budgetDialRose" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#f43f5e" />
                        <stop offset="100%" stopColor="#ea580c" />
                    </linearGradient>
                    <filter id="budgetDialGlowEmerald" x="-40%" y="-40%" width="180%" height="180%">
                        <feGaussianBlur stdDeviation="2.5" result="b" />
                        <feMerge>
                            <feMergeNode in="b" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                    <filter id="budgetDialGlowAmber" x="-40%" y="-40%" width="180%" height="180%">
                        <feGaussianBlur stdDeviation="2.5" result="b" />
                        <feMerge>
                            <feMergeNode in="b" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                    <filter id="budgetDialGlowRose" x="-40%" y="-40%" width="180%" height="180%">
                        <feGaussianBlur stdDeviation="3" result="b" />
                        <feMerge>
                            <feMergeNode in="b" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                </defs>
                <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" strokeWidth={STROKE} className="text-slate-200/90" stroke="currentColor" />
                <circle
                    cx={SIZE / 2}
                    cy={SIZE / 2}
                    r={R}
                    fill="none"
                    stroke={grad}
                    strokeWidth={STROKE}
                    strokeLinecap="round"
                    strokeDasharray={C}
                    strokeDashoffset={offset}
                    transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
                    filter={glow}
                    className="transition-[stroke-dashoffset] duration-700 ease-out"
                />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-[11px] font-extrabold leading-none text-slate-800 tabular-nums tracking-tight">
                    {Math.min(Math.round(pct), 999)}%
                </span>
            </div>
        </div>
    );
};

export default BudgetUsageDial;
