import type { PlannedTrade, TradeCurrency } from '../../types';
import type { PlanDraft } from './suggestions';

export type ApplySuggestedPlansResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
};

function upper(s: string): string {
  return (s || '').trim().toUpperCase();
}

function near(a: number, b: number, pct: number): boolean {
  const da = Number(a);
  const db = Number(b);
  if (!Number.isFinite(da) || !Number.isFinite(db) || da <= 0 || db <= 0) return false;
  return Math.abs(da - db) / db <= pct;
}

function parseLastAutopilotAt(notes: string | null | undefined): number | null {
  const s = (notes || '').trim();
  if (!s) return null;
  // v1 marker: `Autopilot@2026-04-25T20:15:00.000Z`
  const m = s.match(/Autopilot@([0-9]{4}-[0-9]{2}-[0-9]{2}T[^ \n·]+)/g);
  if (!m || m.length === 0) return null;
  const last = m[m.length - 1];
  const iso = last.replace('Autopilot@', '').trim();
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

function nearDateTs(a: unknown, b: unknown, days: number): boolean {
  const ta = Number(a);
  const tb = Number(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return false;
  return Math.abs(ta - tb) <= days * 86400_000;
}

export function applySuggestedPlansLocally(args: {
  drafts: PlanDraft[];
  existingPlans: PlannedTrade[];
  planCurrency: TradeCurrency;
  now?: Date;
  cooldownHours?: number;
}): {
  toCreate: Omit<PlannedTrade, 'id' | 'user_id'>[];
  toUpdate: PlannedTrade[];
  skipped: number;
} {
  const { drafts, existingPlans, now = new Date(), cooldownHours = 12 } = args;
  const eligible = drafts.filter((d) => d.canAutoPlan && d.kind === 'equity' && (d.conditionType === 'price' || d.conditionType === 'date'));

  const byKey = new Map<string, PlannedTrade[]>();
  for (const p of existingPlans) {
    const key = `${upper(p.symbol)}|${p.tradeType}`;
    const arr = byKey.get(key) ?? [];
    arr.push(p);
    byKey.set(key, arr);
  }

  const toCreate: Omit<PlannedTrade, 'id' | 'user_id'>[] = [];
  const toUpdate: PlannedTrade[] = [];
  let skipped = 0;

  for (const d of eligible) {
    const sym = upper(d.symbol);
    const key = `${sym}|${d.tradeType}`;
    const candidates = byKey.get(key) ?? [];
    const match = candidates.find((p) => {
      if (p.conditionType !== d.conditionType) return false;
      if (d.conditionType === 'price') return near(p.targetValue, d.targetValue as number, 0.03);
      return nearDateTs(p.targetValue, d.targetValue, 7);
    });

    const noteTag = `Autopilot@${now.toISOString()}`;
    const notes = [noteTag, ...(d.explanation || []).slice(0, 4)].join(' · ').slice(0, 400);

    if (match) {
      const lastAt = parseLastAutopilotAt(match.notes);
      if (lastAt != null) {
        const dtHours = (now.getTime() - lastAt) / 36e5;
        if (dtHours >= 0 && dtHours < cooldownHours) {
          skipped += 1;
          continue;
        }
      }
      // Update trigger; preserve user sizing if present.
      const next: PlannedTrade = {
        ...match,
        name: d.name || match.name,
        conditionType: d.conditionType,
        targetValue: d.targetValue,
        // Preserve sizing when user already set one; otherwise fill from draft.
        amount: match.amount != null && match.amount > 0 ? match.amount : d.amountPlanCurrency,
        quantity: match.quantity != null && match.quantity > 0 ? match.quantity : d.quantity,
        priority: match.priority || d.priority,
        notes: (match.notes && match.notes.trim() ? `${match.notes} · ${noteTag}` : notes).slice(0, 800),
        status: match.status || 'Planned',
      };
      toUpdate.push(next);
      continue;
    }

    // Create a new plan
    toCreate.push({
      symbol: sym,
      name: d.name || sym,
      tradeType: d.tradeType,
      conditionType: d.conditionType,
      targetValue: d.targetValue,
      quantity: d.quantity,
      amount: d.amountPlanCurrency,
      priority: d.priority,
      notes,
      status: 'Planned',
    });
  }

  // If no eligible drafts, count as skipped
  if (eligible.length === 0) skipped += drafts.length;

  return { toCreate, toUpdate, skipped };
}

