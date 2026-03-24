import { getDefaultWealthUltraConfig } from './config';
import type { WealthUltraConfig } from '../types';

/**
 * Input shape for building the same Wealth Ultra engine config used on the dashboard.
 * Pass full `FinancialData` or a minimal subset (as Wealth Ultra does).
 */
export type FinancialWealthUltraConfigSource = {
  investmentPlan?: unknown;
  wealthUltraConfig?: unknown;
  settings?: { driftThreshold?: number };
  accounts?: unknown[];
  portfolioUniverse?: Array<{ ticker: string; status?: string }>;
  investments?: Array<{ holdings?: Array<{ symbol?: string }> }>;
};

/**
 * Build full Wealth Ultra config from app data. Auto-derives sleeve tickers from Portfolio Universe or holdings when plan lists are empty.
 * Shared by Wealth Ultra dashboard and Settings decision preview.
 */
export function buildFinancialWealthUltraConfig(
  data: FinancialWealthUltraConfigSource | null | undefined,
  totalDeployableCash?: number
): WealthUltraConfig {
  const plan = data?.investmentPlan as any;
  const systemConfig = data?.wealthUltraConfig;
  const defaults = getDefaultWealthUltraConfig();
  const sys =
    systemConfig && typeof systemConfig === 'object' && !Array.isArray(systemConfig)
      ? (systemConfig as Partial<WealthUltraConfig>)
      : {};
  const base = { ...defaults, ...sys } as typeof defaults;

  const accounts = (data as { personalAccounts?: unknown[] })?.personalAccounts ?? data?.accounts ?? [];
  const investments = (data as { personalInvestments?: unknown[] })?.personalInvestments ?? data?.investments ?? [];
  const cashAvailable =
    totalDeployableCash ??
    (accounts as { balance?: number }[]).reduce((s: number, a: { balance?: number }) => s + (a.balance ?? 0), 0);

  const allHoldingTickers: string[] = (investments as { holdings?: Array<{ symbol?: string }> }[])
    .flatMap((p) => p.holdings || [])
    .map((h: { symbol?: string }) => (h.symbol || '').toUpperCase())
    .filter((s: string) => Boolean(s));

  const universe = data?.portfolioUniverse ?? [];

  let coreTickers: string[] = [];
  let upsideTickers: string[] = [];
  let specTickers: string[] = [];

  if (plan) {
    const sleeves = plan.sleeves && Array.isArray(plan.sleeves) && plan.sleeves.length > 0;
    const core = sleeves ? plan.sleeves.find((s: { id: string }) => s.id === 'core' || s.id === 'Core') : null;
    const upside = sleeves ? plan.sleeves.find((s: { id: string }) => s.id === 'upside' || s.id === 'Upside') : null;
    const spec = sleeves ? plan.sleeves.find((s: { id: string }) => s.id === 'spec' || s.id === 'Spec') : null;

    coreTickers = sleeves && core
      ? (core.tickers || [])
      : (plan.corePortfolio ?? []).map((x: { ticker: string }) => (x.ticker || '').toUpperCase()).filter(Boolean);
    upsideTickers = sleeves && upside
      ? (upside.tickers || [])
      : (plan.upsideSleeve ?? []).map((x: { ticker: string }) => (x.ticker || '').toUpperCase()).filter(Boolean);
    specTickers = sleeves && spec ? (spec.tickers || []) : [];
  }

  if (coreTickers.length === 0 && upsideTickers.length === 0 && specTickers.length === 0 && universe.length > 0) {
    universe.forEach((t: { ticker: string; status?: string }) => {
      const sym = (t.ticker || '').toUpperCase();
      if (!sym) return;
      const status = (t.status || '').toLowerCase();
      if (status === 'core') coreTickers.push(sym);
      else if (status === 'high-upside' || status === 'highupside') upsideTickers.push(sym);
      else if (status === 'speculative' || status === 'spec') specTickers.push(sym);
    });
  }

  if (coreTickers.length === 0 && upsideTickers.length === 0 && specTickers.length === 0 && allHoldingTickers.length > 0) {
    coreTickers = [...new Set(allHoldingTickers)];
  }

  const coreSet = new Set(coreTickers.map((t) => t.toUpperCase()));
  const upsideSet = new Set(upsideTickers.map((t) => t.toUpperCase()));
  const specSet = new Set(specTickers.map((t) => t.toUpperCase()));
  const universeByTicker = new Map(
    universe.map((t: { ticker: string; status?: string }) => [(t.ticker || '').toUpperCase(), (t.status || '').toLowerCase()])
  );
  allHoldingTickers.forEach((sym: string) => {
    if (coreSet.has(sym) || upsideSet.has(sym) || specSet.has(sym)) return;
    const status = universeByTicker.get(sym);
    if (status === 'core') coreSet.add(sym);
    else if (status === 'high-upside' || status === 'highupside') upsideSet.add(sym);
    else if (status === 'speculative' || status === 'spec') specSet.add(sym);
    else coreSet.add(sym);
  });
  coreTickers = Array.from(coreSet);
  upsideTickers = Array.from(upsideSet);
  specTickers = Array.from(specSet);

  const hasSleeves = plan?.sleeves && Array.isArray(plan.sleeves) && plan.sleeves.length > 0;
  const coreSleeve = hasSleeves ? plan.sleeves.find((s: { id: string }) => s.id === 'core' || s.id === 'Core') : null;
  const upsideSleeve = hasSleeves ? plan.sleeves.find((s: { id: string }) => s.id === 'upside' || s.id === 'Upside') : null;
  const specSleeve = hasSleeves ? plan.sleeves.find((s: { id: string }) => s.id === 'spec' || s.id === 'Spec') : null;
  const coreExplicit = coreSleeve && typeof coreSleeve.targetPct === 'number';
  const upsideExplicit = upsideSleeve && typeof upsideSleeve.targetPct === 'number';
  const specExplicit = specSleeve && typeof specSleeve.targetPct === 'number';

  let targetCorePct: number;
  let targetUpsidePct: number;
  let targetSpecPct: number;

  if (!plan) {
    targetCorePct = base.targetCorePct;
    targetUpsidePct = base.targetUpsidePct;
    targetSpecPct = base.targetSpecPct;
  } else if (hasSleeves && coreExplicit && upsideExplicit && specExplicit) {
    targetCorePct = coreSleeve.targetPct;
    targetUpsidePct = upsideSleeve.targetPct;
    targetSpecPct = specSleeve.targetPct;
  } else if (hasSleeves && (coreExplicit || upsideExplicit || specExplicit)) {
    targetCorePct = coreExplicit ? coreSleeve.targetPct : base.targetCorePct;
    targetUpsidePct = upsideExplicit ? upsideSleeve.targetPct : base.targetUpsidePct;
    targetSpecPct = specExplicit ? specSleeve.targetPct : base.targetSpecPct;
    const sum = targetCorePct + targetUpsidePct + targetSpecPct;
    if (Math.abs(sum - 100) > 0.01) {
      const scale = 100 / sum;
      targetCorePct *= scale;
      targetUpsidePct *= scale;
      targetSpecPct *= scale;
    }
  } else {
    const specDefault = (plan.specAllocation ?? 0.05) * 100;
    const remainder = 100 - specDefault;
    const coreRatio = (plan.coreAllocation ?? 0.7) / ((plan.coreAllocation ?? 0.7) + (plan.upsideAllocation ?? 0.3));
    const upsideRatio = (plan.upsideAllocation ?? 0.3) / ((plan.coreAllocation ?? 0.7) + (plan.upsideAllocation ?? 0.3));
    targetSpecPct = specDefault;
    targetCorePct = remainder * coreRatio;
    targetUpsidePct = remainder * upsideRatio;
  }

  const settings = data?.settings;
  return {
    ...base,
    monthlyDeposit: plan?.monthlyBudget ?? base.monthlyDeposit,
    cashAvailable,
    targetCorePct,
    targetUpsidePct,
    targetSpecPct,
    coreTickers,
    upsideTickers,
    specTickers,
    driftAlertPct: settings?.driftThreshold ?? (base as { driftAlertPct?: number }).driftAlertPct,
  };
}
