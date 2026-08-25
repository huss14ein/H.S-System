/**
 * Security + lag hardening: hybrid ROI single-pass rollup, AI proxy fail-fast/cap,
 * health info disclosure, and sanitized AI errors.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Account, FinancialData, Holding, InvestmentPortfolio, InvestmentTransaction } from '../types';
import {
  computeHeadlinePersonalInvestmentRoiDecimal,
  computePersonalInvestmentKpiBreakdown,
} from '../services/investmentKpiCore';
import { formatAiError } from '../services/geminiService';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const SAR_PER_USD = 3.75;
const PLATFORM_ID = 'plat-sec-1';

function holding(avgCost: number, qty: number, mark: number): Holding {
  return {
    id: 'h1',
    symbol: '2222.SR',
    quantity: qty,
    avgCost,
    currentValue: mark * qty,
    zakahClass: 'Zakatable',
    realizedPnL: 0,
    assetClass: 'Stock',
  };
}

function fixture(): {
  financial: FinancialData;
  prices: Record<string, { price: number }>;
  getCash: () => { SAR: number; USD: number };
} {
  const account = {
    id: PLATFORM_ID,
    name: 'Broker',
    type: 'Investment',
    balance: 0,
  } as Account;
  const portfolio: InvestmentPortfolio = {
    id: 'pf-1',
    name: 'Main',
    accountId: PLATFORM_ID,
    currency: 'SAR',
    holdings: [holding(100, 10, 120)],
  };
  const financial = {
    accounts: [account],
    personalAccounts: [account],
    investments: [portfolio],
    personalInvestments: [portfolio],
    investmentTransactions: [
      {
        id: 'd1',
        type: 'deposit',
        total: 1000,
        date: '2024-01-01',
        portfolioId: 'pf-1',
        accountId: PLATFORM_ID,
        symbol: 'CASH',
        quantity: 0,
        price: 0,
        currency: 'SAR',
      },
    ] as InvestmentTransaction[],
    transactions: [],
    commodities: [],
    sukuk_positions: [],
  } as FinancialData;
  return {
    financial,
    prices: { '2222.SR': { price: 120 } },
    getCash: () => ({ SAR: 0, USD: 0 }),
  };
}

describe('security / lag hardening completion', () => {
  it('headline ROI reuses breakdown platforms rollup (no second platform scan)', () => {
    const core = read('services/investmentKpiCore.ts');
    expect(core).toContain('platformsRollupSar: number');
    expect(core).toContain('includePlatformHybridNets');
    expect(core).toContain('Reuses platform rollup from the hybrid breakdown pass');
    expect(core).not.toMatch(
      /computeHeadlinePersonalInvestmentRoiDecimal[\s\S]*computePersonalPlatformsRollupSAR\(/,
    );

    const { financial, prices, getCash } = fixture();
    const breakdown = computePersonalInvestmentKpiBreakdown(financial, SAR_PER_USD, getCash, prices);
    const headline = computeHeadlinePersonalInvestmentRoiDecimal(financial, SAR_PER_USD, getCash, prices);
    expect(headline.platformsRollupSar).toBe(breakdown.platformsRollupSar);
    expect(headline.platformsDailyPnLSar).toBe(breakdown.platformsDailyPnLSar);
    expect(breakdown.platformsRollupSar).toBeGreaterThan(0);
  });

  it('cash-drift callers can skip hybrid platform nets', () => {
    const { financial, getCash } = fixture();
    const full = computePersonalInvestmentKpiBreakdown(financial, SAR_PER_USD, getCash, {});
    const light = computePersonalInvestmentKpiBreakdown(financial, SAR_PER_USD, getCash, {}, {
      includePlatformHybridNets: false,
    });
    expect(light.platformsRollupSar).toBe(0);
    expect(light.platformsDailyPnLSar).toBe(0);
    expect(light.expectedCashFromLedgerSpotSar).toBe(full.expectedCashFromLedgerSpotSar);
    expect(read('context/DataContext.tsx')).toContain('includePlatformHybridNets: false');
  });

  it('Netlify gemini-proxy fails fast on auth and caps model cascade', () => {
    const proxy = read('netlify/functions/gemini-proxy.ts');
    expect(proxy).toContain('isAuthError');
    expect(proxy).toContain('MAX_GEMINI_MODELS_TO_TRY');
    expect(proxy).toContain('Same API key will fail every model');
    expect(proxy).toMatch(/healthMode[\s\S]*anyProviderConfigured[\s\S]*\}\);/);
    expect(proxy).not.toMatch(/healthMode[\s\S]*providers:\s*\{/);
  });

  it('Supabase gemini-proxy health omits provider enumeration', () => {
    const edge = read('supabase/functions/gemini-proxy/index.ts');
    expect(edge).toContain('anyProviderConfigured');
    expect(edge).not.toMatch(/health === true[\s\S]*providers:\s*\{/);
  });

  it('formatAiError redacts secrets and avoids dumping raw model payloads', () => {
    const leaked = formatAiError(
      new Error('Upstream failed Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc AIzaSyDummyKeyThatLooksLikeARealGeminiKey123456'),
    );
    expect(leaked).not.toMatch(/AIza/);
    expect(leaked).not.toMatch(/eyJhbGci/);
    expect(leaked).toMatch(/redacted/i);

    const modelDump = formatAiError(
      new Error(`404 model not found: ${JSON.stringify({ error: { message: 'x'.repeat(400) } })}`),
    );
    expect(modelDump).toContain('specified AI model');
    expect(modelDump).not.toContain('"error"');
  });
});
