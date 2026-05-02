/**
 * Dense daily rows for net worth composition chart: missing days inherit the previous day's
 * amounts so the chart never implies "0" when no snapshot was saved for that calendar day.
 */

export type DailyNwRowDense = {
    date: string;
    dayKey: string;
    name: string;
    'Net Worth': number;
    Cash: number;
    Investments: number;
    Physical: number;
    Receivables: number;
    Liabilities: number;
};

function parseLocalDayKey(dayKey: string): Date {
    const [y, m, d] = dayKey.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
}

function shortDayLabelLocal(dayKey: string): string {
    const t = parseLocalDayKey(dayKey);
    return t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function positiveAssetStackTotal(row: Pick<DailyNwRowDense, 'Cash' | 'Investments' | 'Physical' | 'Receivables'>): number {
    return Math.max(0, row.Cash) + Math.max(0, row.Investments) + Math.max(0, row.Physical) + Math.max(0, row.Receivables);
}

/**
 * When a snapshot has net worth but no bucket schema (legacy), scale the previous row's buckets
 * to match the new total so stacked areas don't collapse to a false zero.
 */
export function inheritBucketsWhenMissing(rows: DailyNwRowDense[]): DailyNwRowDense[] {
    let prev: DailyNwRowDense | null = null;
    return rows.map((row) => {
        const nw = Number(row['Net Worth']) || 0;
        const assets = positiveAssetStackTotal(row);
        if (prev && nw > 0.5 && assets < 0.5) {
            const prevNw = Math.max(0.5, Number(prev['Net Worth']) || 0);
            const r = nw / prevNw;
            const next: DailyNwRowDense = {
                ...row,
                Cash: Math.round(prev.Cash * r),
                Investments: Math.round(prev.Investments * r),
                Physical: Math.round(prev.Physical * r),
                Receivables: Math.round(prev.Receivables * r),
                Liabilities: Math.round(prev.Liabilities * r),
            };
            prev = next;
            return next;
        }
        prev = row;
        return row;
    });
}

/** One row per calendar day from first to last day in `rows`, carrying forward values when no snapshot exists. */
export function forwardFillDailyNetWorthRows(rows: DailyNwRowDense[]): DailyNwRowDense[] {
    if (rows.length === 0) return rows;
    const sorted = [...rows].sort((a, b) => a.dayKey.localeCompare(b.dayKey));
    const byDay = new Map(sorted.map((r) => [r.dayKey, r]));
    const start = parseLocalDayKey(sorted[0]!.dayKey);
    const end = parseLocalDayKey(sorted[sorted.length - 1]!.dayKey);
    const out: DailyNwRowDense[] = [];
    let carry: DailyNwRowDense = { ...sorted[0]! };

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dayNum = String(d.getDate()).padStart(2, '0');
        const dk = `${y}-${m}-${dayNum}`;
        const hit = byDay.get(dk);
        if (hit) {
            carry = { ...hit };
            out.push(hit);
        } else {
            const synth: DailyNwRowDense = {
                ...carry,
                dayKey: dk,
                name: shortDayLabelLocal(dk),
                date: `${dk}T12:00:00.000Z`,
            };
            carry = { ...synth };
            out.push(synth);
        }
    }
    return out;
}
