/**
 * Corporate action wizard — step state, validation, dry-run preview.
 * Cost basis for P/L — not tax reporting (KSA scope).
 */
import type { CorporateActionEvent, Holding, InvestmentPortfolio, InvestmentTransaction } from '../types';
import type { CorporateAction } from './corporateActions';
import { applyCorporateAction, splitProducesFraction } from './corporateActions';
import {
  buildCorporateActionEventPayload,
  replayPortfolioHoldingsFromEvents,
  validateCorporateActionApplyPrerequisites,
} from './corporateActionApply';
import {
  filterTransactionsForPortfolioReplay,
  hasPositionAffectingTransactions,
} from './portfolioTransactionScope';

export type CorporateActionWizardActionType =
  | 'stock_split'
  | 'reverse_stock_split'
  | 'stock_dividend'
  | 'cash_in_lieu'
  | 'spinoff'
  | 'merger';

export type CorporateActionWizardStep = 'action' | 'details' | 'preview' | 'confirm';

export interface CorporateActionWizardState {
  portfolioId: string;
  symbol: string;
  actionType: CorporateActionWizardActionType;
  executionDate: string;
  ratioNumerator: string;
  ratioDenominator: string;
  linkedSymbol: string;
  costBasisAllocationPct: string;
  cashPerShare: string;
  cashInLieuPrice: string;
  step: CorporateActionWizardStep;
}

export interface CorporateActionWizardHoldingPreview {
  symbol: string;
  beforeQuantity: number;
  beforeAvgCost: number;
  afterQuantity: number;
  afterAvgCost: number;
  beforeCostBasis: number;
  afterCostBasis: number;
  cashReceived?: number;
  cashInLieu?: number;
}

export interface CorporateActionWizardGrantPreview {
  symbol: string;
  quantity: number;
  avgCost: number;
}

export interface CorporateActionWizardPreview {
  holding: CorporateActionWizardHoldingPreview | null;
  grant?: CorporateActionWizardGrantPreview;
  replaySymbols: Array<{ symbol: string; quantity: number; avgCost: number }>;
  errors: string[];
}

const WIZARD_ACTION_TYPES: CorporateActionWizardActionType[] = [
  'stock_split',
  'reverse_stock_split',
  'stock_dividend',
  'cash_in_lieu',
  'spinoff',
  'merger',
];

export function isCorporateActionWizardActionType(v: string): v is CorporateActionWizardActionType {
  return (WIZARD_ACTION_TYPES as string[]).includes(v);
}

export function createInitialWizardState(
  partial?: Partial<CorporateActionWizardState>,
): CorporateActionWizardState {
  const actionType =
    partial?.actionType && isCorporateActionWizardActionType(partial.actionType)
      ? partial.actionType
      : 'stock_split';
  return {
    portfolioId: partial?.portfolioId ?? '',
    symbol: (partial?.symbol ?? '').trim().toUpperCase(),
    actionType,
    executionDate: partial?.executionDate ?? new Date().toISOString().slice(0, 10),
    ratioNumerator: partial?.ratioNumerator ?? '2',
    ratioDenominator: partial?.ratioDenominator ?? '1',
    linkedSymbol: partial?.linkedSymbol ?? '',
    costBasisAllocationPct: partial?.costBasisAllocationPct ?? '0.2',
    cashPerShare: partial?.cashPerShare ?? '',
    cashInLieuPrice: partial?.cashInLieuPrice ?? '',
    step: partial?.step ?? (partial?.symbol ? 'action' : 'action'),
  };
}

/** Ensure portfolioId belongs to the caller's portfolio list (security gate). */
export function validateCorporateActionWizardPortfolioAccess(
  portfolioId: string,
  portfolios: InvestmentPortfolio[],
): { valid: boolean; portfolio?: InvestmentPortfolio; error?: string } {
  const id = portfolioId?.trim();
  if (!id) return { valid: false, error: 'Select a portfolio.' };
  const portfolio = portfolios.find((p) => p.id === id);
  if (!portfolio) return { valid: false, error: 'Portfolio not found or access denied.' };
  return { valid: true, portfolio };
}

export function wizardStepsForAction(_actionType: CorporateActionWizardActionType): CorporateActionWizardStep[] {
  return ['action', 'details', 'preview', 'confirm'];
}

export function wizardStepIndex(step: CorporateActionWizardStep): number {
  const order: CorporateActionWizardStep[] = ['action', 'details', 'preview', 'confirm'];
  return order.indexOf(step);
}

export function wizardStepLabel(step: CorporateActionWizardStep): string {
  switch (step) {
    case 'action':
      return 'Action';
    case 'details':
      return 'Details';
    case 'preview':
      return 'Preview';
    case 'confirm':
      return 'Confirm';
    default:
      return step;
  }
}

export function getNextWizardStep(
  current: CorporateActionWizardStep,
  actionType: CorporateActionWizardActionType,
): CorporateActionWizardStep | null {
  const steps = wizardStepsForAction(actionType);
  const idx = steps.indexOf(current);
  if (idx < 0 || idx >= steps.length - 1) return null;
  return steps[idx + 1] ?? null;
}

export function getPreviousWizardStep(
  current: CorporateActionWizardStep,
  actionType: CorporateActionWizardActionType,
): CorporateActionWizardStep | null {
  const steps = wizardStepsForAction(actionType);
  const idx = steps.indexOf(current);
  if (idx <= 0) return null;
  return steps[idx - 1] ?? null;
}

export function buildCorporateActionFromWizardState(state: CorporateActionWizardState): CorporateAction {
  const num = Number(state.ratioNumerator) || 1;
  const den = Number(state.ratioDenominator) || 1;
  return {
    type: state.actionType,
    ratioNumerator: num,
    ratioDenominator: den,
    costBasisAllocationPct: Number(state.costBasisAllocationPct) || 0,
    linkedSymbol: state.linkedSymbol.trim() || undefined,
    cashPerShare: state.cashPerShare ? Number(state.cashPerShare) : undefined,
    cashInLieuPrice: state.cashInLieuPrice ? Number(state.cashInLieuPrice) : undefined,
    conversionRatio: num / den,
  };
}

export function validateWizardStep(
  state: CorporateActionWizardState,
  portfolios: InvestmentPortfolio[],
  step: CorporateActionWizardStep = state.step,
  options?: {
    transactions?: InvestmentTransaction[];
    corporateActionEvents?: CorporateActionEvent[];
  },
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (step === 'action' || step === 'details' || step === 'preview' || step === 'confirm') {
    const access = validateCorporateActionWizardPortfolioAccess(state.portfolioId, portfolios);
    if (!access.valid) errors.push(access.error ?? 'Invalid portfolio.');
    if (!state.symbol.trim()) errors.push('Select a symbol.');
  }

  if (step === 'details' || step === 'preview' || step === 'confirm') {
    const num = Number(state.ratioNumerator);
    const den = Number(state.ratioDenominator);
    if (!Number.isFinite(num) || num <= 0) errors.push('Ratio numerator must be a positive number.');
    if (!Number.isFinite(den) || den <= 0) errors.push('Ratio denominator must be a positive number.');
    if (!state.executionDate?.trim()) errors.push('Execution date is required.');

    if (state.actionType === 'spinoff' || state.actionType === 'merger') {
      if (!state.linkedSymbol.trim()) errors.push('Linked symbol is required.');
    }
    if (state.actionType === 'spinoff') {
      const pct = Number(state.costBasisAllocationPct);
      if (!Number.isFinite(pct) || pct < 0 || pct > 1) {
        errors.push('Cost basis allocation must be between 0 and 1 (e.g. 0.2 for 20%).');
      }
    }
    if (state.actionType === 'cash_in_lieu') {
      const price = Number(state.cashInLieuPrice);
      if (!Number.isFinite(price) || price < 0) {
        errors.push('Cash-in-lieu price per fractional share is required.');
      }
    }
    if (state.actionType === 'reverse_stock_split') {
      const portfolio = portfolios.find((p) => p.id === state.portfolioId);
      const holding = portfolio?.holdings?.find(
        (h) => String(h.symbol ?? '').toUpperCase() === state.symbol.toUpperCase(),
      );
      const qty = Number(holding?.quantity) || 0;
      const action = buildCorporateActionFromWizardState(state);
      if (splitProducesFraction(qty, action)) {
        const price = Number(state.cashInLieuPrice);
        if (!Number.isFinite(price) || price < 0) {
          errors.push('Cash-in-lieu price per fractional share is required when the reverse split leaves a fraction.');
        }
      }
    }
    if (state.actionType === 'merger' && state.cashPerShare.trim()) {
      const cash = Number(state.cashPerShare);
      if (!Number.isFinite(cash) || cash < 0) errors.push('Cash per share must be zero or positive.');
    }

    const portfolio = portfolios.find((p) => p.id === state.portfolioId);
    const holding = portfolio?.holdings?.find(
      (h) => String(h.symbol ?? '').toUpperCase() === state.symbol.toUpperCase(),
    );
    if (portfolio && !holding) {
      errors.push(`No holding for ${state.symbol} in this portfolio.`);
    }
    if (
      portfolio &&
      holding &&
      (state.actionType === 'stock_split' || state.actionType === 'reverse_stock_split') &&
      options?.transactions
    ) {
      const prereq = validateCorporateActionApplyPrerequisites({
        portfolioId: state.portfolioId,
        symbol: state.symbol,
        transactions: options.transactions,
        corporateActionEvents: options.corporateActionEvents ?? [],
        accountId: portfolio.accountId ?? (portfolio as { account_id?: string }).account_id,
        holdingSymbols: (portfolio.holdings ?? []).map((h) => String(h.symbol ?? '')),
      });
      if (!prereq.valid && prereq.error) errors.push(prereq.error);
    }
  }

  if (step === 'preview' || step === 'confirm') {
    try {
      buildCorporateActionEventPayload({
        portfolioId: state.portfolioId,
        symbol: state.symbol,
        executionDate: state.executionDate,
        action: buildCorporateActionFromWizardState(state),
        linkedSymbol: state.linkedSymbol.trim() || undefined,
      });
    } catch (e) {
      errors.push(e instanceof Error ? e.message : 'Invalid corporate action payload.');
    }
  }

  return { valid: errors.length === 0, errors };
}

export async function previewCorporateActionWizard(args: {
  state: CorporateActionWizardState;
  portfolio: InvestmentPortfolio;
  transactions: InvestmentTransaction[];
  corporateActionEvents: CorporateActionEvent[];
}): Promise<CorporateActionWizardPreview> {
  const validation = validateWizardStep(args.state, [args.portfolio], 'preview', {
    transactions: args.transactions,
    corporateActionEvents: args.corporateActionEvents,
  });
  if (!validation.valid) {
    return { holding: null, replaySymbols: [], errors: validation.errors };
  }

  const action = buildCorporateActionFromWizardState(args.state);
  const sym = args.state.symbol.toUpperCase();
  const holding = args.portfolio.holdings?.find((h) => String(h.symbol ?? '').toUpperCase() === sym);
  const holdingLike = { quantity: holding?.quantity ?? 0, avgCost: holding?.avgCost ?? 0 };
  const applied = applyCorporateAction({ action, holding: holdingLike });

  const holdingPreview: CorporateActionWizardHoldingPreview | null = holding
    ? {
        symbol: sym,
        beforeQuantity: holdingLike.quantity,
        beforeAvgCost: holdingLike.avgCost,
        afterQuantity: applied.quantity,
        afterAvgCost: applied.avgCost,
        beforeCostBasis: holdingLike.quantity * holdingLike.avgCost,
        afterCostBasis: applied.quantity * applied.avgCost,
        cashReceived: applied.cashReceived,
        cashInLieu: applied.cashInLieu,
      }
    : null;

  const grant = applied.spinoffGrant ?? applied.mergerGrant;

  const payload = buildCorporateActionEventPayload({
    portfolioId: args.state.portfolioId,
    symbol: args.state.symbol,
    executionDate: args.state.executionDate,
    action,
    linkedSymbol: args.state.linkedSymbol.trim() || undefined,
  });

  const previewEvent: CorporateActionEvent = {
    id: `preview-${payload.idempotency_key}`,
    portfolioId: args.state.portfolioId,
    actionType: payload.action_type as CorporateActionEvent['actionType'],
    symbol: payload.symbol,
    linkedSymbol: payload.linked_symbol,
    executionDate: payload.execution_date,
    ratioNumerator: payload.ratio_numerator,
    ratioDenominator: payload.ratio_denominator,
    cashPerShare: payload.cash_per_share,
    cashInLieuPrice: action.cashInLieuPrice ?? payload.price_per_share ?? undefined,
    costBasisAllocationPct: payload.cost_basis_allocation_pct,
    idempotencyKey: payload.idempotency_key,
    status: 'applied',
  };

  const replayed = await replayPortfolioHoldingsFromEvents({
    portfolio: args.portfolio,
    transactions: args.transactions,
    corporateActionEvents: [...args.corporateActionEvents, previewEvent],
    holdingsBaselineMode: 'as_stored',
    holdingsReplayEvents: (() => {
      const replayTxs = filterTransactionsForPortfolioReplay({
        portfolioId: args.state.portfolioId,
        transactions: args.transactions,
        holdingSymbols: args.portfolio.holdings?.map((h) => String(h.symbol ?? '')),
        accountId: args.portfolio.accountId ?? (args.portfolio as { account_id?: string }).account_id,
      });
      return !hasPositionAffectingTransactions(replayTxs) ? [previewEvent] : undefined;
    })(),
  });

  /** Only symbols this CA touches — apply persists the same scope; other holdings are unchanged. */
  const affectedSymbols = new Set(
    [sym, args.state.linkedSymbol, grant?.symbol]
      .map((s) => String(s ?? '').trim().toUpperCase())
      .filter(Boolean),
  );

  const replaySymbols = Array.from(replayed.entries())
    .map(([symbol, r]) => ({ symbol, quantity: r.quantity, avgCost: r.avgCost }))
    .filter((r) => affectedSymbols.has(r.symbol.toUpperCase()))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  return {
    holding: holdingPreview,
    grant: grant
      ? { symbol: grant.symbol, quantity: grant.quantity, avgCost: grant.avgCost }
      : undefined,
    replaySymbols,
    errors: [],
  };
}

export function corporateActionWizardActionLabel(type: CorporateActionWizardActionType): string {
  switch (type) {
    case 'stock_split':
      return 'Stock split';
    case 'reverse_stock_split':
      return 'Reverse split';
    case 'stock_dividend':
      return 'Bonus / stock dividend';
    case 'cash_in_lieu':
      return 'Cash in lieu (fractional)';
    case 'spinoff':
      return 'Spinoff';
    case 'merger':
      return 'Merger / acquisition';
    default:
      return type;
  }
}

export function wizardReverseSplitNeedsCashInLieu(state: CorporateActionWizardState, quantity: number): boolean {
  if (state.actionType !== 'reverse_stock_split') return false;
  const action = buildCorporateActionFromWizardState(state);
  return splitProducesFraction(quantity, action);
}

export function holdingSymbolsForPortfolio(portfolio: InvestmentPortfolio | undefined): string[] {
  const set = new Set<string>();
  (portfolio?.holdings ?? []).forEach((h: Holding) => {
    if (h.symbol) set.add(h.symbol.toUpperCase());
  });
  return Array.from(set).sort();
}
