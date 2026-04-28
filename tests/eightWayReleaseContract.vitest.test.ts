/**
 * Living contract: the 8 recent product areas stay wired and behaviorally sound in CI.
 * (Goal funding, windfall, investment KPI capital, dashboard snapshot, SMS import, import AI text,
 * Wealth Ultra orders, portfolio universe / content hint — see each describe block.)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeWindfallAllocationPct } from '../services/windfallAllocation';
import { computeGoalFundingPlan } from '../services/goalFundingRouter';
import { computePersonalInvestmentKpiBreakdown } from '../services/investmentKpiCore';
import { computeDashboardKpiSnapshot } from '../services/dashboardKpiSnapshot';
import { parseSMSTransactions } from '../services/statementParser';
import { generateOrders } from '../wealth-ultra/orderGenerator';
import { extractProxyResponseText } from '../services/geminiService';
import { lookupHintForTitle } from '../content/sectionInfoHints';
import type { FinancialData, Account, Transaction, InvestmentPortfolio, InvestmentTransaction } from '../types';
import type { WealthUltraConfig, WealthUltraPosition } from '../types';

vi.mock('../services/geminiService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/geminiService')>();
  return {
    ...actual,
    invokeAI: vi.fn(() => Promise.resolve({ text: '[]' })),
  };
});

import { invokeAI } from '../services/geminiService';

const FX = 3.75;
const acc: Account = { id: 'a1', name: 'Inv', type: 'Investment', balance: 0, currency: 'SAR' } as Account;
const getCash = () => ({ SAR: 0, USD: 0 });

function minData(over: Partial<FinancialData> = {}): FinancialData {
  return {
    accounts: [acc],
    personalAccounts: [acc],
    personalInvestments: [] as InvestmentPortfolio[],
    investments: [] as InvestmentPortfolio[],
    transactions: [] as Transaction[],
    goals: [],
    budgets: [],
    investmentTransactions: [] as InvestmentTransaction[],
    ...over,
  } as FinancialData;
}

const WU_BASE: WealthUltraConfig = {
  fxRate: 3.75,
  targetCorePct: 65,
  targetUpsidePct: 28,
  targetSpecPct: 7,
  defaultTarget1Pct: 14,
  defaultTarget2Pct: 27,
  defaultTrailingPct: 11,
  monthlyDeposit: 0,
  cashAvailable: 0,
  cashReservePct: 12,
  maxPerTickerPct: 16,
  riskWeightLow: 1,
  riskWeightMed: 1.3,
  riskWeightHigh: 1.65,
  riskWeightSpec: 2.2,
};

function wuPos(p: Partial<WealthUltraPosition> & Pick<WealthUltraPosition, 'ticker' | 'strategyMode' | 'currentShares'>): WealthUltraPosition {
  return {
    sleeveType: 'Core',
    riskTier: 'Med',
    avgCost: 10,
    currentPrice: 10,
    marketValue: 1000,
    plDollar: 0,
    plPct: 0,
    applyTarget1: true,
    applyTarget2: false,
    applyTrailing: true,
    ...p,
  } as WealthUltraPosition;
}

describe('8-way release contract', () => {
  beforeEach(() => {
    vi.mocked(invokeAI).mockResolvedValue({ text: '[]' } as never);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('1 · windfall allocation percentages sum to 100', () => {
    const w = computeWindfallAllocationPct({
      emergencyRunwayMonths: 3,
      weightedGoalGapSum: 50_000,
      annualSurplusAnchorSar: 120_000,
    });
    expect(w.emergencyPct + w.goalsPct + w.investPct).toBe(100);
    expect(w.derivationLines.length).toBeGreaterThan(0);
  });

  it('2 · goal funding plan returns bounded suggestions', () => {
    const plan = computeGoalFundingPlan(minData({ goals: [] }), 0, FX);
    expect(plan.suggestions).toEqual([]);
    expect(plan.totalMonthlySurplus).toBe(0);
  });

  it('3 · investment KPI breakdown exposes capitalSource', () => {
    const b = computePersonalInvestmentKpiBreakdown(minData(), FX, getCash);
    expect(['deposits', 'ledger_inferred', 'cost_basis_fallback']).toContain(b.capitalSource);
  });

  it('4 · dashboard KPI snapshot includes investmentCapitalSource', () => {
    const snap = computeDashboardKpiSnapshot(minData(), FX, getCash);
    expect(snap).not.toBeNull();
    expect(snap!.investmentCapitalSource).toBeDefined();
  });

  it('5 · SMS parse works without network (mocked AI); deterministic path may skip AI', async () => {
    const sms = `شراء عبر نقاط البيع\nلدى:TEST\nSAR مبلغ:5.75\n8/4/26`;
    const res = await parseSMSTransactions(sms, 'acc-x');
    expect(res.transactions.length).toBeGreaterThan(0);
  });

  it('6 · extractProxyResponseText reads text or candidates[]', () => {
    expect(extractProxyResponseText({ text: 'hello' })).toBe('hello');
    expect(
      extractProxyResponseText({
        candidates: [{ content: { parts: [{ text: 'nested' }] } }],
      }),
    ).toBe('nested');
    expect(extractProxyResponseText(null)).toBe('');
  });

  it('7 · Wealth Ultra sells: Trim uses partial qty, Hold produces no sells', () => {
    const sellsHold = generateOrders(
      [wuPos({ ticker: 'X', strategyMode: 'Hold', currentShares: 100, plPct: 5 })],
      WU_BASE,
    ).filter((o) => o.type === 'SELL');
    expect(sellsHold).toHaveLength(0);

    const trim = generateOrders(
      [wuPos({ ticker: 'Y', strategyMode: 'Trim', currentShares: 100, plPct: 45, marketValue: 1450, plDollar: 450 })],
      WU_BASE,
    ).find((o) => o.type === 'SELL');
    expect(trim?.qty).toBe(33);
  });

  it('8 · Goals windfall hint registry mentions cockpit anchor', () => {
    const h = lookupHintForTitle('Bonus / windfall allocation ideas');
    expect(h).toBeDefined();
    expect(h!).toMatch(/funding cockpit|12.?month/i);
  });
});
