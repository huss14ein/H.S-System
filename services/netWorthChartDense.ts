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

export type NetWorthTrendSparseRow = { dayKey: string; netWorth: number };

export type NetWorthTrendPoint = {
    dayKey: string;
    name: string;
    netWorth: number;
};

/** One row per calendar day (latest wins when duplicates exist). */
export function dedupeNetWorthRowsByDay(rows: NetWorthTrendSparseRow[]): NetWorthTrendSparseRow[] {
    const byDay = new Map<string, number>();
    for (const r of rows) {
        byDay.set(r.dayKey, Number(r.netWorth));
    }
    return Array.from(byDay.entries())
        .map(([dayKey, netWorth]) => ({ dayKey, netWorth }))
        .sort((a, b) => a.dayKey.localeCompare(b.dayKey));
}

/**
 * Replace zero / invalid snapshot levels with the last known good value so charts never
 * dip to a false zero when hydrate failed or a sparse row was saved mid-load.
 */
export function carryForwardInvalidNetWorthSnapshots(
    rows: NetWorthTrendSparseRow[],
    seedNetWorthBeforeRange?: number | null,
): NetWorthTrendSparseRow[] {
    let lastGood =
        seedNetWorthBeforeRange != null && Number.isFinite(seedNetWorthBeforeRange) && seedNetWorthBeforeRange > 0.5
            ? seedNetWorthBeforeRange
            : null;

    return rows.map((r) => {
        const nw = Number(r.netWorth);
        if (Number.isFinite(nw) && nw > 0.5) {
            lastGood = nw;
            return r;
        }
        if (lastGood != null) {
            return { dayKey: r.dayKey, netWorth: lastGood };
        }
        return r;
    });
}

/** Dense daily net worth trend: missing days inherit previous snapshot (never zero). */
export function forwardFillNetWorthTrendRows(
    rows: NetWorthTrendSparseRow[],
    labelForDayKey: (dayKey: string) => string = shortDayLabelLocal,
    seedNetWorthBeforeRange?: number | null,
): NetWorthTrendPoint[] {
    const sanitized = carryForwardInvalidNetWorthSnapshots(dedupeNetWorthRowsByDay(rows), seedNetWorthBeforeRange);
    if (sanitized.length === 0) return [];

    const sorted = [...sanitized].sort((a, b) => a.dayKey.localeCompare(b.dayKey));
    const byDay = new Map(sorted.map((r) => [r.dayKey, r.netWorth]));
    const start = parseLocalDayKey(sorted[0]!.dayKey);
    const end = parseLocalDayKey(sorted[sorted.length - 1]!.dayKey);
    const out: NetWorthTrendPoint[] = [];
    let carry = sorted[0]!.netWorth;

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dayNum = String(d.getDate()).padStart(2, '0');
        const dk = `${y}-${m}-${dayNum}`;
        const hit = byDay.get(dk);
        if (hit != null && Number.isFinite(hit) && hit > 0.5) {
            carry = hit;
        }
        out.push({
            dayKey: dk,
            name: labelForDayKey(dk),
            netWorth: carry,
        });
    }
    return out;
}

export function buildNetWorthTrendSeriesFromSnapshots(
    sparseRows: NetWorthTrendSparseRow[],
    labelForDayKey: (dayKey: string) => string = shortDayLabelLocal,
    seedNetWorthBeforeRange?: number | null,
): NetWorthTrendPoint[] {
    return forwardFillNetWorthTrendRows(sparseRows, labelForDayKey, seedNetWorthBeforeRange);
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
