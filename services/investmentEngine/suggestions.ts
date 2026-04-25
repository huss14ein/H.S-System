import type { TradeCurrency } from '../../types';
import { buyScore, sellScore } from '../decisionEngine';
import { loadTradingPolicy, evaluateBuyAgainstPolicy } from '../tradingPolicy';
import type { EngineInstrument, EngineUniverse } from './universe';
import { toSAR } from '../../utils/currencyMath';

export type SuggestionConfidence = 'High' | 'Medium' | 'Low';
export type SuggestionSeverity = 'safe' | 'review' | 'blocked';

export type PlanDraft = {
  draftId: string;
  kind: EngineInstrument['kind'];
  /** Only equities become real planned_trades. */
  canAutoPlan: boolean;
  symbol: string;
  name: string;
  tradeType: 'buy' | 'sell';
  conditionType: 'price' | 'date';
  /** Price trigger in instrument currency, or a Date timestamp (ms) for date plans. */
  targetValue: number;
  instrumentCurrency: TradeCurrency;
  /** Amount in plan currency (SAR or USD) */
  amountPlanCurrency?: number;
  /** Optional quantity (shares/units) */
  quantity?: number;
  priority: 'High' | 'Medium' | 'Low';
  confidence: SuggestionConfidence;
  severity: SuggestionSeverity;
  explanation: string[];
  tags: string[];
  /** Optional link back to portfolio/holding */
  portfolioId?: string;
  holdingId?: string;
  commodityId?: string;
  assetId?: string;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function confidenceFromScore(s: number): SuggestionConfidence {
  if (s >= 80) return 'High';
  if (s >= 60) return 'Medium';
  return 'Low';
}

function priorityFromConfidence(c: SuggestionConfidence, tradeType: 'buy' | 'sell'): 'High' | 'Medium' | 'Low' {
  if (tradeType === 'sell') return c === 'High' ? 'High' : 'Medium';
  return c === 'High' ? 'Medium' : c === 'Medium' ? 'Medium' : 'Low';
}

function isActionableStatus(status: EngineInstrument['status']): boolean {
  return status === 'Core' || status === 'High-Upside';
}

function isBlockedStatus(status: EngineInstrument['status']): boolean {
  return status === 'Quarantine' || status === 'Excluded';
}

export function generateInvestmentPlanSuggestions(args: {
  universe: EngineUniverse;
  /** Plan currency (what user thinks in); affects amount suggestions only. */
  planCurrency: TradeCurrency;
  /** Monthly budget in plan currency (used for sizing). */
  monthlyBudget: number;
  coreAllocation: number; // 0–1
  upsideAllocation: number; // 0–1
  /** Existing planned trades for de-dupe (symbol+tradeType). */
  existingPlanKeys?: Set<string>;
  /** Optional: enforce policy guardrails for buy sizing. */
  policyContext?: { runwayMonths: number; monthlyNetLast30d: number };
}): { drafts: PlanDraft[]; buy: PlanDraft[]; sell: PlanDraft[]; notes: string[] } {
  const { universe, monthlyBudget, coreAllocation, upsideAllocation, existingPlanKeys, policyContext } = args;
  const notes: string[] = [];
  const policy = loadTradingPolicy();

  const eq = universe.instruments.filter((i) => i.kind === 'equity');
  const equityTotalSar = Math.max(1, universe.totals.equitiesSar);

  const drafts: PlanDraft[] = [];

  const mkKey = (sym: string, side: 'buy' | 'sell') => `${sym.toUpperCase()}|${side}`;

  // --- Equity suggestions (auto-plan capable) ---
  for (const i of eq) {
    const sym = (i.symbol || '').toUpperCase();
    const hasLive = i.priceNow != null && Number.isFinite(i.priceNow) && i.priceNow! > 0;
    const posPct = (i.positionValueSar / equityTotalSar) * 100;
    const maxPct = i.maxPositionWeight != null && Number.isFinite(i.maxPositionWeight) ? i.maxPositionWeight * 100 : 25;
    const aboveMax = posPct - maxPct;

    // Sell: quarantine/excluded or above max by meaningful margin.
    if (isBlockedStatus(i.status) || aboveMax >= 1.5) {
      if (!hasLive) {
        drafts.push({
          draftId: `sell:${sym}:no_price`,
          kind: 'equity',
          canAutoPlan: true,
          symbol: sym,
          name: i.name || sym,
          tradeType: 'sell',
          conditionType: 'price',
          targetValue: 1, // placeholder; marked blocked/review
          instrumentCurrency: i.instrumentCurrency,
          amountPlanCurrency: undefined,
          priority: 'High',
          confidence: 'Low',
          severity: 'blocked',
          explanation: [
            'Live price is missing, so we cannot set a reliable sell trigger.',
            'Refresh prices or record a recent price, then re-run suggestions.',
          ],
          tags: ['missing_price', 'sell'],
          portfolioId: i.portfolioId,
          holdingId: i.holdingId,
        });
        continue;
      }
      const s = sellScore({ aboveTargetWeightPct: aboveMax > 0 ? aboveMax : undefined, thesisBroken: isBlockedStatus(i.status), needCash: false });
      const conf = confidenceFromScore(s.score);
      const target = Number((i.priceNow! * (isBlockedStatus(i.status) ? 1.0 : 1.01)).toFixed(4));
      const severity: SuggestionSeverity = isBlockedStatus(i.status) ? 'review' : aboveMax >= 4 ? 'review' : 'safe';
      const expl: string[] = [];
      if (isBlockedStatus(i.status)) expl.push(`This stock is marked ${i.status}: avoid adding and consider trimming.`);
      if (aboveMax >= 1.5) expl.push(`Position is above your cap by ~${aboveMax.toFixed(1)}%.`);
      expl.push('We set a conservative sell trigger near today’s price so you can review and execute when ready.');
      const key = mkKey(sym, 'sell');
      if (existingPlanKeys?.has(key)) {
        // Keep as “draft” but tag as update
        expl.push('A sell plan already exists; applying will update it instead of duplicating.');
      }
      drafts.push({
        draftId: `sell:${sym}`,
        kind: 'equity',
        canAutoPlan: true,
        symbol: sym,
        name: i.name || sym,
        tradeType: 'sell',
        conditionType: 'price',
        targetValue: target,
        instrumentCurrency: i.instrumentCurrency,
        amountPlanCurrency: undefined,
        priority: priorityFromConfidence(conf, 'sell'),
        confidence: conf,
        severity,
        explanation: expl,
        tags: ['sell', isBlockedStatus(i.status) ? 'quarantine' : 'trim'],
        portfolioId: i.portfolioId,
        holdingId: i.holdingId,
      });
      continue;
    }

    // Buy: actionable names, under cap, with live price.
    if (isActionableStatus(i.status) && hasLive) {
      const sleeve = i.status === 'Core' ? 'Core' : 'High-Upside';
      const sleeveAlloc = i.status === 'Core' ? coreAllocation : upsideAllocation;
      const base = monthlyBudget > 0 ? monthlyBudget * sleeveAlloc : 0;
      const perName = base > 0 ? Math.max(100, base * 0.15) : 0;
      const headroomPct = maxPct - posPct;
      const sizeFactor = clamp(headroomPct / 10, 0.2, 1);
      const suggestedAmt = perName > 0 ? Math.round(perName * sizeFactor) : undefined;
      const pullback = i.status === 'Core' ? 0.02 : 0.03;
      const target = Number((i.priceNow! * (1 - pullback)).toFixed(4));

      const driftFromTargetPct = i.monthlyWeight != null && Number.isFinite(i.monthlyWeight)
        ? ((i.monthlyWeight * 100) - posPct)
        : undefined;
      const score = buyScore({
        maxPositionPct: maxPct,
        currentPositionPct: posPct,
        driftFromTargetPct: driftFromTargetPct,
      });
      const conf = confidenceFromScore(score);
      let severity: SuggestionSeverity = headroomPct <= 0.5 ? 'review' : 'safe';
      const expl: string[] = [
        `${sleeve} name with headroom to your max cap.`,
        `Buy trigger is a small pullback (~${Math.round(pullback * 100)}%) to avoid chasing price.`,
      ];
      if (suggestedAmt != null) expl.push(`Suggested size uses your monthly plan and available headroom (editable).`);
      if (i.monthlyWeight != null && Number.isFinite(i.monthlyWeight)) {
        expl.push(`Universe weight is ${(i.monthlyWeight * 100).toFixed(2)}% (used as a soft guide, not a guarantee).`);
      }
      const key = mkKey(sym, 'buy');
      if (existingPlanKeys?.has(key)) expl.push('A buy plan already exists; applying will update it instead of duplicating.');

      // Hard guardrails: cash runway / negative net / max weight after this buy.
      if (policyContext && suggestedAmt != null && suggestedAmt > 0) {
        const amtSar = toSAR(suggestedAmt, args.planCurrency, universe.sarPerUsd);
        const positionWeightAfterBuyPct = posPct + (amtSar / equityTotalSar) * 100;
        const r = evaluateBuyAgainstPolicy({
          policy,
          runwayMonths: policyContext.runwayMonths,
          monthlyNetLast30d: policyContext.monthlyNetLast30d,
          positionWeightAfterBuyPct,
        });
        if (!r.allowed) {
          severity = 'blocked';
          expl.unshift(r.reason || 'Blocked by trading policy.');
          expl.push('Adjust your budget, increase runway, or lower sizing, then refresh.');
        } else if (positionWeightAfterBuyPct > maxPct) {
          severity = 'review';
          expl.unshift(`This size may exceed your cap after buy (~${positionWeightAfterBuyPct.toFixed(1)}% vs cap ${maxPct.toFixed(1)}%).`);
        }
      }

      drafts.push({
        draftId: `buy:${sym}`,
        kind: 'equity',
        canAutoPlan: true,
        symbol: sym,
        name: i.name || sym,
        tradeType: 'buy',
        conditionType: 'price',
        targetValue: target,
        instrumentCurrency: i.instrumentCurrency,
        amountPlanCurrency: suggestedAmt,
        priority: priorityFromConfidence(conf, 'buy'),
        confidence: conf,
        severity,
        explanation: expl,
        tags: ['buy', 'pullback'],
        portfolioId: i.portfolioId,
        holdingId: i.holdingId,
      });
    }
  }

  // --- Commodities and Sukuk: guidance only (not written to `planned_trades`) ---
  for (const i of universe.instruments.filter((x) => x.kind !== 'equity')) {
    if (i.kind === 'commodity') {
      const hasPx = i.priceNow != null && Number.isFinite(i.priceNow) && i.priceNow! > 0;
      const target = hasPx ? Number((i.priceNow! * 0.98).toFixed(4)) : 1;
      const amt = monthlyBudget > 0 ? Math.round(monthlyBudget * 0.05) : undefined;
      drafts.push({
        draftId: `commodity:${i.symbol}:buy`,
        kind: 'commodity',
        canAutoPlan: false,
        symbol: i.symbol,
        name: i.name,
        tradeType: 'buy',
        conditionType: 'price',
        targetValue: target,
        instrumentCurrency: i.instrumentCurrency,
        amountPlanCurrency: amt,
        priority: 'Low',
        confidence: 'Low',
        severity: hasPx ? 'review' : 'blocked',
        explanation: [
          hasPx ? 'Commodity top-up suggestion (recorded on the Commodities page).' : 'Commodity price is missing; refresh prices first.',
          'This plan will guide you and link you to the right page to record the change.',
        ],
        tags: ['commodity', 'guidance'],
        commodityId: i.commodityId,
      });
      continue;
    }
    if (i.kind === 'sukuk') {
      const nextMonth = (() => {
        const d = new Date();
        d.setMonth(d.getMonth() + 1);
        const ymd = d.toISOString().slice(0, 10);
        // Store as a timestamp so it matches PlannedTrade schema.
        return new Date(ymd).getTime();
      })();
      const amt = monthlyBudget > 0 ? Math.round(monthlyBudget * 0.1) : undefined;
      drafts.push({
        draftId: `sukuk:${i.symbol}:review`,
        kind: 'sukuk',
        canAutoPlan: false,
        symbol: i.symbol,
        name: i.name,
        tradeType: 'buy',
        conditionType: 'date',
        targetValue: nextMonth,
        instrumentCurrency: 'SAR',
        amountPlanCurrency: amt,
        priority: 'Low',
        confidence: 'Low',
        severity: 'review',
        explanation: [
          'Sukuk is tracked under Assets (not broker trades).',
          'This creates a reminder-style plan and links you to Assets to update the Sukuk value/schedule.',
        ],
        tags: ['sukuk', 'guidance'],
        assetId: i.assetId,
      });
    }
  }

  // Keep the UI friendly: show top candidates by confidence then severity.
  const rank = (d: PlanDraft) => {
    const conf = d.confidence === 'High' ? 3 : d.confidence === 'Medium' ? 2 : 1;
    const sev = d.severity === 'safe' ? 2 : d.severity === 'review' ? 1 : 0;
    return conf * 10 + sev;
  };

  const buy = drafts.filter((d) => d.tradeType === 'buy' && d.kind === 'equity').sort((a, b) => rank(b) - rank(a)).slice(0, 10);
  const sell = drafts.filter((d) => d.tradeType === 'sell' && d.kind === 'equity').sort((a, b) => rank(b) - rank(a)).slice(0, 10);

  if (monthlyBudget <= 0) notes.push('Monthly budget is not set; sizing will be conservative or empty.');
  if (buy.length === 0) notes.push('No clear buy candidates found (check live prices, caps, and Core/High-upside status).');
  if (sell.length === 0) notes.push('No clear sell candidates found (no quarantine or cap breaches detected).');

  return { drafts, buy, sell, notes };
}

