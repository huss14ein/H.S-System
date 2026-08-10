/**
 * Corporate action wizard — model, navigation, and UI wiring.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CORPORATE_ACTION_WIZARD_STORAGE_KEY,
  clearCorporateActionWizardPlan,
  openCorporateActionWizard,
  readCorporateActionWizardPlan,
  stashCorporateActionWizardPlan,
} from '../services/corporateActionNavigation';
import {
  buildCorporateActionFromWizardState,
  createInitialWizardState,
  previewCorporateActionWizard,
  validateCorporateActionWizardPortfolioAccess,
  validateWizardStep,
} from '../services/corporateActionWizardModel';
import type { InvestmentPortfolio, InvestmentTransaction } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

function mockSessionStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => store.get(k) ?? null,
    key: (i: number) => [...store.keys()][i] ?? null,
    removeItem: (k: string) => {
      store.delete(k);
    },
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
  };
}

const portfolio: InvestmentPortfolio = {
  id: 'p1',
  name: 'Growth',
  accountId: 'a1',
  holdings: [
    {
      id: 'h1',
      symbol: 'AAPL',
      name: 'Apple',
      quantity: 10,
      avgCost: 100,
      currentValue: 1200,
      zakahClass: 'Zakatable',
      realizedPnL: 0,
      assetClass: 'Stock',
    },
  ],
};

describe('corporateActionNavigation', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', mockSessionStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stashes and reads wizard plan from sessionStorage', () => {
    stashCorporateActionWizardPlan({ portfolioId: 'p1', symbol: 'aapl', actionType: 'stock_split' });
    const plan = readCorporateActionWizardPlan();
    expect(plan).toEqual({ portfolioId: 'p1', symbol: 'AAPL', actionType: 'stock_split' });
    clearCorporateActionWizardPlan();
    expect(readCorporateActionWizardPlan()).toBeNull();
  });

  it('openCorporateActionWizard triggers from-plan page action when pre-filled', () => {
    const calls: string[] = [];
    openCorporateActionWizard({
      portfolioId: 'p1',
      symbol: 'MSFT',
      triggerPageAction: (_page, action) => {
        calls.push(action);
      },
    });
    expect(calls).toEqual(['open-corporate-action-wizard:from-plan']);
    expect(sessionStorage.getItem(CORPORATE_ACTION_WIZARD_STORAGE_KEY)).toBeTruthy();
  });

  it('openCorporateActionWizard falls back to bare wizard action', () => {
    const calls: string[] = [];
    openCorporateActionWizard({
      triggerPageAction: (_page, action) => {
        calls.push(action);
      },
    });
    expect(calls).toEqual(['open-corporate-action-wizard']);
  });
});

describe('corporateActionWizardModel', () => {
  it('rejects portfolioId not owned by user portfolio list', () => {
    const result = validateCorporateActionWizardPortfolioAccess('foreign', [portfolio]);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/access denied/i);
  });

  it('accepts portfolioId in user portfolio list', () => {
    const result = validateCorporateActionWizardPortfolioAccess('p1', [portfolio]);
    expect(result.valid).toBe(true);
    expect(result.portfolio?.id).toBe('p1');
  });

  it('validates split details and builds corporate action', () => {
    const state = createInitialWizardState({
      portfolioId: 'p1',
      symbol: 'AAPL',
      actionType: 'stock_split',
      step: 'details',
    });
    const validation = validateWizardStep(state, [portfolio], 'details');
    expect(validation.valid).toBe(true);
    const action = buildCorporateActionFromWizardState(state);
    expect(action.type).toBe('stock_split');
    expect(action.ratioNumerator).toBe(2);
    expect(action.conversionRatio).toBe(2);
  });

  it('requires linked symbol for spinoff', () => {
    const state = createInitialWizardState({
      portfolioId: 'p1',
      symbol: 'AAPL',
      actionType: 'spinoff',
      linkedSymbol: '',
      step: 'details',
    });
    const validation = validateWizardStep(state, [portfolio], 'details');
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => /linked symbol/i.test(e))).toBe(true);
  });

  it('dry-run preview doubles quantity on 2:1 split via apply + replay', async () => {
    const buyTx: InvestmentTransaction = {
      id: 't1',
      portfolioId: 'p1',
      accountId: 'a1',
      date: '2026-01-01',
      type: 'buy',
      symbol: 'AAPL',
      quantity: 10,
      price: 100,
      total: 1000,
    };
    const state = createInitialWizardState({
      portfolioId: 'p1',
      symbol: 'AAPL',
      actionType: 'stock_split',
      ratioNumerator: '2',
      ratioDenominator: '1',
      step: 'preview',
    });
    const preview = await previewCorporateActionWizard({
      state,
      portfolio,
      transactions: [buyTx],
      corporateActionEvents: [],
    });
    expect(preview.errors).toHaveLength(0);
    expect(preview.holding?.beforeQuantity).toBe(10);
    expect(preview.holding?.afterQuantity).toBeCloseTo(20, 4);
    expect(preview.holding?.afterAvgCost).toBeCloseTo(50, 4);
    expect(preview.holding?.beforeCostBasis).toBeCloseTo(1000, 2);
    expect(preview.holding?.afterCostBasis).toBeCloseTo(1000, 2);
    const replayAapl = preview.replaySymbols.find((r) => r.symbol === 'AAPL');
    expect(replayAapl?.quantity).toBeCloseTo(20, 4);
  });

  it('preview replaySymbols lists only the CA symbol — not untouched portfolio peers', async () => {
    const multi: InvestmentPortfolio = {
      ...portfolio,
      holdings: [
        ...portfolio.holdings,
        {
          id: 'h2',
          symbol: 'AMZN',
          name: 'Amazon',
          quantity: 10,
          avgCost: 200,
          currentValue: 2000,
          zakahClass: 'Zakatable',
          realizedPnL: 0,
          assetClass: 'Stock',
        },
        {
          id: 'h3',
          symbol: 'BABA',
          name: 'Alibaba',
          quantity: 10,
          avgCost: 100,
          currentValue: 1000,
          zakahClass: 'Zakatable',
          realizedPnL: 0,
          assetClass: 'Stock',
        },
      ],
    };
    const preview = await previewCorporateActionWizard({
      state: createInitialWizardState({
        portfolioId: 'p1',
        symbol: 'AAPL',
        actionType: 'reverse_stock_split',
        ratioNumerator: '1',
        ratioDenominator: '20',
        step: 'preview',
      }),
      portfolio: multi,
      transactions: [],
      corporateActionEvents: [],
    });
    expect(preview.errors).toHaveLength(0);
    expect(preview.replaySymbols.map((r) => r.symbol)).toEqual(['AAPL']);
    expect(preview.replaySymbols.find((r) => r.symbol === 'AMZN')).toBeUndefined();
  });
});

describe('corporateActionsWizard wiring', () => {
  it('wizard shell and step components exist', () => {
    expect(read('components/investments/corporateActions/CorporateActionWizard.tsx')).toContain('CorporateActionWizard');
    expect(read('components/investments/corporateActions/CorporateActionWizard.tsx')).toContain(
      'Affected positions after apply',
    );
    expect(read('components/investments/corporateActions/CorporateActionWizard.tsx')).not.toContain(
      'Portfolio replay (after apply)',
    );
    expect(read('components/investments/corporateActions/SplitWizardSteps.tsx')).toContain('SplitWizardSteps');
    expect(read('components/investments/corporateActions/SpinoffMergerWizardSteps.tsx')).toContain('SpinoffMergerWizardSteps');
    expect(read('components/investments/corporateActions/CashInLieuWizardSteps.tsx')).toContain('CashInLieuWizardSteps');
  });

  it('Investments hub wires wizard launcher and holding modal entry', () => {
    const page = read('pages/Investments.tsx');
    expect(page).toContain('CorporateActionWizard');
    expect(page).toContain('Corporate action…');
    expect(page).toContain('open-corporate-action-wizard');
    expect(page).toContain('onLaunchWizard');
    expect(read('components/investments/CorporateActionApplyPanel.tsx')).toContain('Guided wizard');
  });

  it('pageActions whitelist includes corporate action wizard routes', () => {
    const actions = read('utils/pageActions.ts');
    expect(actions).toContain('open-corporate-action-wizard');
    expect(actions).toContain('open-corporate-action-wizard:from-plan');
  });
});
