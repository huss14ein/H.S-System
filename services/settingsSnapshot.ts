import type { FinancialData, Settings } from '../types';
import {
  getPersonalAccounts,
  getPersonalCommodityHoldings,
  getPersonalInvestments,
  getPersonalTransactions,
} from '../utils/wealthScope';

const MS_90D = 90 * 86400000;

/** How complete the risk/budget side of profile is (0–100). */
export function computeProfileSetupPercent(settings: Partial<Settings> | null | undefined): number {
  const s = settings ?? {};
  let ok = 0;
  const checks = [
    Boolean(s.riskProfile && ['Conservative', 'Moderate', 'Aggressive'].includes(String(s.riskProfile))),
    Number.isFinite(Number(s.budgetThreshold)) && Number(s.budgetThreshold) > 0,
    Number.isFinite(Number(s.driftThreshold)) && Number(s.driftThreshold) >= 0,
    Number.isFinite(Number((s as { goldPrice?: number }).goldPrice)) && Number((s as { goldPrice?: number }).goldPrice) > 0,
  ];
  checks.forEach((c) => {
    if (c) ok++;
  });
  return Math.round((ok / checks.length) * 100);
}

/** Accounts readiness: presence, activity, diversity (0–100). */
export function computeAccountsSetupPercent(data: FinancialData | null | undefined): number {
  if (!data) return 0;
  const accounts = getPersonalAccounts(data);
  if (accounts.length === 0) return 0;
  let score = 35;
  const types = new Set(accounts.map((a) => a.type));
  if (types.size >= 2) score += 20;
  const withBal = accounts.filter((a) => Math.abs(Number(a.balance) || 0) > 0).length;
  if (withBal > 0) score += 25;
  const txs = getPersonalTransactions(data);
  const cut = Date.now() - MS_90D;
  if (txs.some((t) => t?.date && new Date(t.date).getTime() >= cut)) score += 20;
  return Math.min(100, score);
}

/** Financial preference items configured (meaningful ranges). Four checks — not `enableEmails` (always boolean once settings exist). */
export function computePreferencesConfigured(settings: Partial<Settings> | null | undefined): {
  done: number;
  total: number;
} {
  const s = settings ?? {};
  const checks = [
    ['Conservative', 'Moderate', 'Aggressive'].includes(String(s.riskProfile)),
    Number(s.budgetThreshold) >= 50 && Number(s.budgetThreshold) <= 100,
    Number(s.driftThreshold) >= 0 && Number(s.driftThreshold) <= 20,
    Number((s as { goldPrice?: number }).goldPrice) > 0,
  ];
  return { done: checks.filter(Boolean).length, total: checks.length };
}

/** Unique symbols: personal holdings, watchlist, and personal commodity tickers (e.g. XAU, BTC). */
export function countTrackedSymbolsForFeed(data: FinancialData | null | undefined): number {
  if (!data) return 0;
  const syms = new Set<string>();
  for (const p of getPersonalInvestments(data)) {
    for (const h of p.holdings ?? []) {
      const u = String(h.symbol ?? '').trim().toUpperCase();
      if (u) syms.add(u);
    }
  }
  for (const w of data.watchlist ?? []) {
    const u = String(w.symbol ?? '').trim().toUpperCase();
    if (u) syms.add(u);
  }
  for (const c of getPersonalCommodityHoldings(data)) {
    const u = String(c.symbol ?? '').trim().toUpperCase();
    if (u) syms.add(u);
  }
  return syms.size;
}

export function countActivePriceAlerts(data: FinancialData | null | undefined): number {
  return (data?.priceAlerts ?? []).filter((a) => a.status === 'active').length;
}

/** 1 when sleeve drift exceeds user threshold and drift is known; else 0. */
export function countPortfolioDriftAttention(
  sleeveDriftPct: number | null,
  driftThreshold: number
): number {
  if (sleeveDriftPct == null || !Number.isFinite(sleeveDriftPct)) return 0;
  return sleeveDriftPct > driftThreshold ? 1 : 0;
}
