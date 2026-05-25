import type { Holding, InvestmentPortfolio, PlannedTrade, TradeCurrency } from '../types';
import type { DataContextFinancialData } from '../types';
import { inferInstrumentCurrencyFromSymbol, resolveSarPerUsd, toSAR, tradableCashBucketToSAR } from '../utils/currencyMath';
import { resolveCanonicalAccountId } from '../utils/investmentLedgerCurrency';
import { resolveInvestmentPortfolioCurrency } from '../utils/investmentPortfolioCurrency';
import { effectiveHoldingUnitPriceInBookCurrency, effectiveHoldingValueInBookCurrency } from '../utils/holdingValuation';
import { lookupLiveQuoteForSymbol, lookupQuoteUpdatedAtIso } from './finnhubService';
import { buildRecoveryPlan, DEFAULT_RECOVERY_GLOBAL_CONFIG } from './recoveryPlan';
import { buildRecyclingPlanForHolding, summarizeRecyclingPlan, type RecyclingPlanSummary } from './positionRecyclingIntegration';
import { resolveSyncedRecoveryConviction } from './recoveryConvictionSync';
import { tickerToRiskTier, tickerToSleeve } from '../wealth-ultra/position';

export type SimulatedPricesLike = Record<string, { price?: number; change?: number } | undefined>;
export type SymbolQuoteUpdatedAt = Record<string, string>;

export type CanonicalPlanInputs = {
  data: DataContextFinancialData;
  exchangeRate: number;
  /** When set, matches `computePersonalHeadlineNetWorthSar` / `useCanonicalFinancialMetrics().sarPerUsd`. */
  sarPerUsd?: number;
  simulatedPrices: SimulatedPricesLike;
  getAvailableCashForAccount: (accountId: string) => { SAR: number; USD: number };
  /** Optional: per-symbol ISO timestamp from MarketDataContext; used for freshness/confidence. */
  symbolQuoteUpdatedAt?: SymbolQuoteUpdatedAt;
  /** Optional override for "now" (testing). Defaults to Date.now(). */
  nowMs?: number;
};

export type QuoteFreshness = {
  updatedAtIso: string | null;
  ageMinutes: number | null;
  /** True only when we have a timestamp and it is older than the stale threshold. */
  isStale: boolean;
  /** No quote timestamp in session (still may have a price from cache). */
  isAgeUnknown: boolean;
};

export type PriceProvenance = {
  source: 'quote' | 'stored_market_value' | 'avg_cost' | 'unknown';
  quoteFreshness: QuoteFreshness;
};

export type PlanCashFeasibility = {
  /** Deployable broker cash (SAR) considered for this plan. */
  deployableSar: number;
  /** How deployable cash was scoped for this buy plan. */
  scope: 'explicit_portfolio' | 'explicit_account' | 'holding_accounts' | 'all_platforms';
  linkedPortfolioNames: string[];
  /** Estimated order notional in SAR (buy only). */
  notionalSar: number | null;
  status: 'n/a' | 'unknown_notional' | 'sufficient' | 'tight' | 'insufficient';
  detail: string;
};

export type CanonicalInvestmentPlanRow = {
  plan: PlannedTrade;
  symbolUpper: string;
  instrumentCurrency: TradeCurrency;
  triggerPrice: number | null;
  spotPrice: number | null;
  spotVsTriggerRatio: number | null;
  statusLabel: 'Waiting price' | 'Near plan' | 'Favorable' | 'Above trigger' | 'Below plan';
  spotQuoteFreshness: QuoteFreshness;
  cash: PlanCashFeasibility;
  decision: {
    canDecide: boolean;
    confidence: 'high' | 'medium' | 'low';
    reasons: string[];
  };
};

export type CanonicalRecoveryPosition = {
  holding: Holding;
  portfolioId: string;
  portfolioName: string;
  bookCurrency: TradeCurrency;
  currentUnitPriceBook: number;
  plan: ReturnType<typeof buildRecoveryPlan>;
  priceProvenance: PriceProvenance;
};

export type CanonicalBalancerPortfolioSnapshot = {
  portfolioId: string;
  portfolioName: string;
  bookCurrency: TradeCurrency;
  totalHoldingsValueBook: number;
  allocationBySymbol: Array<{ symbol: string; valueBook: number; weightPct: number }>;
};

export type CanonicalPlanningSnapshot = {
  sarPerUsd: number;
  investmentPlan: {
    rows: CanonicalInvestmentPlanRow[];
    /** Price-trigger plans sorted by priority for quick review (High → Medium → Low). */
    prioritizedPricePlans: CanonicalInvestmentPlanRow[];
  };
  recoveryPlan: {
    deployableCashSar: number;
    positions: CanonicalRecoveryPosition[];
    qualified: CanonicalRecoveryPosition[];
    /** No-new-cash sell/rebuy summaries for underwater holdings. */
    recyclingSummaries: RecyclingPlanSummary[];
  };
  aiBalancer: {
    portfolios: CanonicalBalancerPortfolioSnapshot[];
  };
  dataQuality: {
    staleQuoteThresholdMinutes: number;
  };
};

function safeUpper(s: string | undefined | null): string {
  return String(s ?? '').trim().toUpperCase();
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function computeCanonicalPlanningSnapshot(inputs: CanonicalPlanInputs): CanonicalPlanningSnapshot {
  const { data, exchangeRate, sarPerUsd: sarPerUsdOverride, simulatedPrices, getAvailableCashForAccount, symbolQuoteUpdatedAt, nowMs } = inputs;
  const now = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now();
  const staleQuoteThresholdMinutes = 90; // default: 1.5 hours (covers non-continuous markets + manual refresh cadence)
  const sarPerUsd =
    typeof sarPerUsdOverride === 'number' && Number.isFinite(sarPerUsdOverride) && sarPerUsdOverride > 0
      ? sarPerUsdOverride
      : resolveSarPerUsd(data ?? null, exchangeRate);

  const quoteFreshnessForSymbol = (symbol: string): QuoteFreshness => {
    const iso = lookupQuoteUpdatedAtIso(symbolQuoteUpdatedAt ?? undefined, symbol);
    if (!iso) {
      return { updatedAtIso: null, ageMinutes: null, isStale: false, isAgeUnknown: true };
    }
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return { updatedAtIso: iso, ageMinutes: null, isStale: true, isAgeUnknown: false };
    const ageMinutes = Math.max(0, (now - t) / 60000);
    return {
      updatedAtIso: iso,
      ageMinutes,
      isStale: ageMinutes > staleQuoteThresholdMinutes,
      isAgeUnknown: false,
    };
  };

  const personalAccounts = data.personalAccounts ?? data.accounts ?? [];
  const investAccounts = personalAccounts.filter((a) => a.type === 'Investment');
  const deployableCashSar = investAccounts.reduce((sum, a) => {
    return sum + tradableCashBucketToSAR(getAvailableCashForAccount(a.id), sarPerUsd);
  }, 0);

  const personalPortfolios = (data.personalInvestments ?? data.investments ?? []) as InvestmentPortfolio[];

  const portfolioSymbolMap = new Map<string, { portfolioName: string; accountId: string }[]>();
  for (const p of personalPortfolios) {
    const portfolioName = p.name ?? 'Portfolio';
    const accountId = String(p.accountId ?? '');
    for (const h of p.holdings ?? []) {
      const sym = safeUpper(h.symbol);
      if (!sym) continue;
      const list = portfolioSymbolMap.get(sym) ?? [];
      list.push({ portfolioName, accountId });
      portfolioSymbolMap.set(sym, list);
    }
  }

  const priorityRank = (p: PlannedTrade['priority']) => (p === 'High' ? 0 : p === 'Medium' ? 1 : 2);

  const computePlanCash = (
    plan: PlannedTrade,
    symbolUpper: string,
    instrumentCurrency: TradeCurrency,
    triggerPrice: number | null,
    portfolioSymbolMap: Map<string, { portfolioName: string; accountId: string }[]>,
  ): PlanCashFeasibility => {
    if (plan.tradeType !== 'buy') {
      return {
        deployableSar: deployableCashSar,
        scope: 'all_platforms',
        linkedPortfolioNames: [],
        notionalSar: null,
        status: 'n/a',
        detail: 'Sell plans free shares; cash check applies to buys.',
      };
    }

    const explicitPfId = String(plan.portfolioId ?? '').trim();
    const explicitAccRaw = String(plan.accountId ?? '').trim();
    const investIdSet = new Set(investAccounts.map((a) => a.id));

    let resolvedAccountId = '';
    let venuePfName: string | null = null;

    if (explicitPfId) {
      const pf = personalPortfolios.find((p) => String(p.id ?? '') === explicitPfId);
      if (pf) {
        venuePfName = pf.name ?? null;
        const rawAid = String(pf.accountId ?? '').trim();
        resolvedAccountId = rawAid ? resolveCanonicalAccountId(rawAid, personalAccounts) || rawAid : '';
      }
    }
    if (!resolvedAccountId && explicitAccRaw) {
      resolvedAccountId = resolveCanonicalAccountId(explicitAccRaw, personalAccounts) || explicitAccRaw;
    }

    const explicitRequested = Boolean(explicitPfId || explicitAccRaw);
    const venueValid = Boolean(resolvedAccountId && investIdSet.has(resolvedAccountId));

    let deployableSar = 0;
    let scope: PlanCashFeasibility['scope'];
    let linkedPortfolioNames: string[] = [];

    if (explicitRequested && !venueValid) {
      deployableSar = 0;
      scope = explicitPfId ? 'explicit_portfolio' : 'explicit_account';
      linkedPortfolioNames = [];
    } else if (venueValid && resolvedAccountId) {
      deployableSar = tradableCashBucketToSAR(getAvailableCashForAccount(resolvedAccountId), sarPerUsd);
      if (explicitPfId) {
        scope = 'explicit_portfolio';
        linkedPortfolioNames = [(venuePfName && String(venuePfName).trim()) || 'Portfolio'];
      } else {
        scope = 'explicit_account';
        const acc = personalAccounts.find((a) => a.id === resolvedAccountId);
        linkedPortfolioNames = [acc?.name || 'Platform'];
      }
    } else {
      const buckets = portfolioSymbolMap.get(symbolUpper) ?? [];
      const rawAccountIds = Array.from(new Set(buckets.map((b) => b.accountId).filter(Boolean)));
      if (rawAccountIds.length > 0) {
        scope = 'holding_accounts';
        linkedPortfolioNames = Array.from(new Set(buckets.map((b) => b.portfolioName)));
        const seenCanon = new Set<string>();
        for (const raw of rawAccountIds) {
          const canon = resolveCanonicalAccountId(String(raw), personalAccounts) || String(raw);
          if (seenCanon.has(canon)) continue;
          seenCanon.add(canon);
          deployableSar += tradableCashBucketToSAR(getAvailableCashForAccount(canon), sarPerUsd);
        }
      } else {
        deployableSar = deployableCashSar;
        scope = 'all_platforms';
        linkedPortfolioNames = [];
      }
    }

    let notionalSar: number | null = null;
    const amt = Number(plan.amount);
    if (Number.isFinite(amt) && amt > 0) {
      notionalSar = toSAR(amt, 'SAR', sarPerUsd);
    } else if (triggerPrice && Number(plan.quantity) > 0) {
      const raw = Number(plan.quantity) * triggerPrice;
      notionalSar = toSAR(raw, instrumentCurrency, sarPerUsd);
    }

    if (explicitRequested && !venueValid) {
      if (notionalSar == null || !Number.isFinite(notionalSar)) {
        return {
          deployableSar: 0,
          scope,
          linkedPortfolioNames,
          notionalSar: null,
          status: 'unknown_notional',
          detail:
            'Execution venue is missing or not an investment platform. Update Execute on or choose Auto, then add amount or quantity.',
        };
      }
      return {
        deployableSar: 0,
        scope,
        linkedPortfolioNames,
        notionalSar,
        status: 'insufficient',
        detail: `Invalid execution venue—deployable cash treated as 0. Notional ~${Math.round(notionalSar).toLocaleString()} SAR. Fix venue or use Auto.`,
      };
    }

    if (notionalSar == null || !Number.isFinite(notionalSar)) {
      const roundedDep = Math.round(deployableSar).toLocaleString();
      let ctx: string;
      if (scope === 'holding_accounts') {
        ctx = `Deployable ~${roundedDep} SAR on platforms holding ${symbolUpper}.`;
      } else if (scope === 'explicit_portfolio' || scope === 'explicit_account') {
        ctx = `Deployable ~${roundedDep} SAR on the selected venue.`;
      } else {
        ctx = `Total deployable ~${roundedDep} SAR across investment platforms.`;
      }
      return {
        deployableSar,
        scope,
        linkedPortfolioNames,
        notionalSar: null,
        status: 'unknown_notional',
        detail: `${ctx} Add amount or quantity to estimate capital needed.`,
      };
    }

    const ratio = deployableSar > 0 ? notionalSar / deployableSar : Infinity;
    let status: PlanCashFeasibility['status'];
    let detail: string;
    if (notionalSar <= deployableSar + 1e-6) {
      if (ratio >= 0.85) {
        status = 'tight';
        detail = `Notional ~${Math.round(notionalSar).toLocaleString()} SAR vs deployable ~${Math.round(deployableSar).toLocaleString()} SAR (≥85%—leave buffer for fees/slippage).`;
      } else {
        status = 'sufficient';
        detail = `Notional ~${Math.round(notionalSar).toLocaleString()} SAR fits within deployable ~${Math.round(deployableSar).toLocaleString()} SAR.`;
      }
    } else {
      status = 'insufficient';
      detail = `Notional ~${Math.round(notionalSar).toLocaleString()} SAR exceeds deployable ~${Math.round(deployableSar).toLocaleString()} SAR—fund the platform or reduce size.`;
    }

    return { deployableSar, scope, linkedPortfolioNames, notionalSar, status, detail };
  };

  // --- Investment Plan (planned trades) ---
  const plannedTrades = data?.plannedTrades ?? [];
  const planRows: CanonicalInvestmentPlanRow[] = plannedTrades.map((plan) => {
    const symbolUpper = safeUpper(plan.symbol);
    const instrumentCurrency = inferInstrumentCurrencyFromSymbol(symbolUpper) as TradeCurrency;
    const triggerPrice = plan.conditionType === 'price' && Number.isFinite(plan.targetValue) && plan.targetValue > 0 ? plan.targetValue : null;
    const spotPriceRaw = lookupLiveQuoteForSymbol(simulatedPrices as any, plan.symbol)?.price;
    const spotPrice = Number.isFinite(spotPriceRaw as number) && (spotPriceRaw as number) > 0 ? (spotPriceRaw as number) : null;
    const ratio = triggerPrice && spotPrice ? (spotPrice - triggerPrice) / triggerPrice : null;
    const spotQuoteFreshness = quoteFreshnessForSymbol(plan.symbol);
    const cash = computePlanCash(plan, symbolUpper, instrumentCurrency, triggerPrice, portfolioSymbolMap);

    let statusLabel: CanonicalInvestmentPlanRow['statusLabel'] = 'Waiting price';
    if (triggerPrice && spotPrice) {
      const abs = Math.abs((spotPrice - triggerPrice) / triggerPrice);
      if (abs <= 0.01) statusLabel = 'Near plan';
      else if (plan.tradeType === 'buy') statusLabel = spotPrice <= triggerPrice ? 'Favorable' : 'Above trigger';
      else statusLabel = spotPrice >= triggerPrice ? 'Favorable' : 'Below plan';
    }

    const reasons: string[] = [];
    if (plan.conditionType !== 'price') reasons.push('Date-based plan (no price decision).');
    if (!triggerPrice) reasons.push('Missing or invalid trigger price.');
    if (!spotPrice) reasons.push('Missing spot price (refresh quotes).');
    if (spotQuoteFreshness.isStale) reasons.push('Spot quote is stale (refresh quotes).');
    if (spotQuoteFreshness.isAgeUnknown && spotPrice) reasons.push('Quote refresh time unknown—tap Refresh prices for certainty.');
    if (plan.tradeType === 'buy') {
      if (cash.status === 'insufficient') reasons.push('Estimated buy notional exceeds deployable cash on relevant platform(s).');
      else if (cash.status === 'tight') reasons.push('Buy size is a large share of deployable cash—confirm buffer for fees.');
      else if (cash.status === 'unknown_notional') reasons.push('Add trade amount or quantity to check cash feasibility.');
    }

    const priceDecisionOk =
      plan.conditionType === 'price' && Boolean(triggerPrice && spotPrice && !spotQuoteFreshness.isStale);
    /** Only hard-fail buys when notional is known and exceeds cash; unknown size stays price-actionable. */
    const cashOkForBuy =
      plan.tradeType !== 'buy' ||
      cash.status === 'n/a' ||
      cash.status === 'unknown_notional' ||
      cash.status === 'sufficient' ||
      cash.status === 'tight';
    const canDecide = Boolean(priceDecisionOk && cashOkForBuy);

    let confidence: CanonicalInvestmentPlanRow['decision']['confidence'];
    if (canDecide && !spotQuoteFreshness.isAgeUnknown) confidence = 'high';
    else if (canDecide && spotQuoteFreshness.isAgeUnknown) confidence = 'medium';
    else if (triggerPrice && spotPrice && !spotQuoteFreshness.isStale) confidence = 'medium';
    else confidence = 'low';

    return {
      plan,
      symbolUpper,
      instrumentCurrency,
      triggerPrice,
      spotPrice,
      spotVsTriggerRatio: ratio,
      statusLabel,
      spotQuoteFreshness,
      cash,
      decision: { canDecide, confidence, reasons },
    };
  });

  const prioritizedPricePlans = planRows
    .filter((r) => r.plan.conditionType === 'price' && r.plan.status !== 'Executed')
    .slice()
    .sort((a, b) => {
      const pa = priorityRank(a.plan.priority);
      const pb = priorityRank(b.plan.priority);
      if (pa !== pb) return pa - pb;
      const da = a.decision.canDecide === b.decision.canDecide ? 0 : a.decision.canDecide ? -1 : 1;
      if (da !== 0) return da;
      return (a.symbolUpper || '').localeCompare(b.symbolUpper || '');
    });

  // --- Recovery Plan (positions in loss) ---
  const globalConfig = {
    ...DEFAULT_RECOVERY_GLOBAL_CONFIG,
    deployableCash: deployableCashSar,
    minDeployableThreshold: Math.max(300, Math.min(1200, deployableCashSar * 0.01)),
    recoveryBudgetPct: Math.max(0.12, Math.min(0.35, 0.18 + (deployableCashSar > 50000 ? 0.04 : 0))),
  };

  const universe = data?.portfolioUniverse ?? [];
  const coreTickers = new Set(universe.filter((u) => u.status === 'Core').map((u) => safeUpper(u.ticker)));
  const upsideTickers = new Set(universe.filter((u) => u.status === 'High-Upside').map((u) => safeUpper(u.ticker)));
  const specTickers = new Set(universe.filter((u) => u.status === 'Speculative').map((u) => safeUpper(u.ticker)));
  const ip = data?.investmentPlan;
  if (coreTickers.size === 0 && upsideTickers.size === 0 && ip) {
    (ip.corePortfolio ?? []).forEach((row) => {
      const t = safeUpper(row.ticker);
      if (t) coreTickers.add(t);
    });
    (ip.upsideSleeve ?? []).forEach((row) => {
      const t = safeUpper(row.ticker);
      if (t) upsideTickers.add(t);
    });
  }
  const sleeveInput = { coreTickers: [...coreTickers], upsideTickers: [...upsideTickers], specTickers: [...specTickers] };
  const recoveryPositions: CanonicalRecoveryPosition[] = [];
  const recyclingSummaries: RecyclingPlanSummary[] = [];
  for (const p of personalPortfolios) {
    const bookCurrency = (resolveInvestmentPortfolioCurrency(p) as TradeCurrency) || 'USD';
    for (const h of p.holdings ?? []) {
      const qty = Number(h.quantity) || 0;
      if (qty <= 0) continue;
      const sym = safeUpper(h.symbol);
      if (!sym) continue;

      const currentUnitPriceBook = effectiveHoldingUnitPriceInBookCurrency(h, bookCurrency, simulatedPrices, sarPerUsd);
      const qf = quoteFreshnessForSymbol(sym);
      const priceProvenance: PriceProvenance = {
        source: qf.updatedAtIso ? 'quote' : Number(h.currentValue || 0) > 0 ? 'stored_market_value' : Number(h.avgCost || 0) > 0 ? 'avg_cost' : 'unknown',
        quoteFreshness: qf,
      };
      const sleeveType = tickerToSleeve(sym, sleeveInput.coreTickers.length || sleeveInput.upsideTickers.length ? sleeveInput : undefined);
      const riskTier = tickerToRiskTier(sym, sleeveInput.coreTickers.length || sleeveInput.upsideTickers.length ? sleeveInput : undefined);
      const deployableCashInBook = bookCurrency === 'SAR' ? deployableCashSar : deployableCashSar / sarPerUsd;

      const lossTriggerPct = 20;
      const cashCap = Math.max(1200, Math.min(deployableCashInBook * 0.35, deployableCashInBook * 0.11));

      const positionConfig = {
        symbol: sym,
        sleeveType,
        riskTier,
        recoveryEnabled: sleeveType !== 'Spec',
        lossTriggerPct,
        cashCap,
      };

      const positionGlobal = { ...globalConfig, deployableCash: deployableCashInBook };
      const plan = buildRecoveryPlan(h, currentUnitPriceBook, positionConfig as any, positionGlobal as any);

      recoveryPositions.push({
        holding: h,
        portfolioId: String(p.id ?? ''),
        portfolioName: p.name ?? 'Portfolio',
        bookCurrency,
        currentUnitPriceBook,
        plan,
        priceProvenance,
      });

      if (plan.plPct < 0 && currentUnitPriceBook > 0) {
        const synced = resolveSyncedRecoveryConviction({
          symbol: sym,
          plPct: plan.plPct,
          riskTier: positionConfig.riskTier,
          universe,
        });
        const recyclingPlan = buildRecyclingPlanForHolding(h, currentUnitPriceBook, positionConfig as any, {
          convictionGrade: synced.convictionGrade,
          stockQualityStatus: synced.stockQualityStatus,
        });
        recyclingSummaries.push(summarizeRecyclingPlan(recyclingPlan));
      }
    }
  }

  const qualified = recoveryPositions.filter((p) => p.plan?.qualified);

  // --- AI Balancer snapshot (deterministic, grounded) ---
  const balancerPortfolios: CanonicalBalancerPortfolioSnapshot[] = personalPortfolios.map((p) => {
    const bookCurrency = (resolveInvestmentPortfolioCurrency(p) as TradeCurrency) || 'USD';
    const lines = (p.holdings ?? [])
      .map((h) => {
        const sym = safeUpper(h.symbol);
        const valueBook = effectiveHoldingValueInBookCurrency(h, bookCurrency, simulatedPrices, sarPerUsd);
        return { symbol: sym || '—', valueBook };
      })
      .filter((x) => Number.isFinite(x.valueBook) && x.valueBook > 0);
    const total = lines.reduce((s, x) => s + x.valueBook, 0);
    const allocationBySymbol = lines
      .sort((a, b) => b.valueBook - a.valueBook)
      .map((x) => ({ ...x, weightPct: total > 0 ? clamp01(x.valueBook / total) * 100 : 0 }));
    return {
      portfolioId: String(p.id ?? ''),
      portfolioName: p.name ?? 'Portfolio',
      bookCurrency,
      totalHoldingsValueBook: total,
      allocationBySymbol,
    };
  });

  return {
    sarPerUsd,
    investmentPlan: { rows: planRows, prioritizedPricePlans },
    recoveryPlan: { deployableCashSar, positions: recoveryPositions, qualified, recyclingSummaries },
    aiBalancer: { portfolios: balancerPortfolios },
    dataQuality: { staleQuoteThresholdMinutes },
  };
}

