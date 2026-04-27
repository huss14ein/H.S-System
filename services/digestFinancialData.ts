import type {
  Account,
  Asset,
  CommodityHolding,
  FinancialData,
  Holding,
  InvestmentPortfolio,
  InvestmentTransaction,
  Liability,
} from '../types';
import { getDefaultWealthUltraSystemConfig, mergeWealthUltraSystemConfigFromRow } from '../wealth-ultra/config';
import { resolveInvestmentPortfolioCurrency } from '../utils/investmentPortfolioCurrency';
import { roundAvgCostPerUnit, roundMoney, roundQuantity } from '../utils/money';

function resolveAccountId(candidate: string | undefined, accounts: Account[]): string | undefined {
  const c = (candidate ?? '').trim();
  if (!c) return undefined;
  const direct = accounts.find((a) => a.id === c);
  if (direct) return direct.id;
  const external = accounts.find(
    (a) => ((a as { account_id?: string; accountId?: string }).account_id ?? (a as { accountId?: string }).accountId) === c,
  );
  return external?.id;
}

function digestNormalizeAccount(raw: Record<string, unknown>): Account {
  const id = raw.id ?? raw.account_id ?? (raw as { uuid?: string }).uuid ?? '';
  const name = String(raw.name ?? '');
  const rawType = String(raw.type ?? '').trim().toLowerCase();
  const type = (
    raw.type === 'Savings' || raw.type === 'Investment' || raw.type === 'Credit'
      ? raw.type
      : rawType.includes('invest')
        ? 'Investment'
        : rawType.includes('sav')
          ? 'Savings'
          : rawType.includes('credit')
            ? 'Credit'
            : 'Checking'
  ) as Account['type'];
  const balance = roundMoney(Number(raw.balance ?? 0));
  const linkedAccountIds = raw.linkedAccountIds ?? raw.linked_account_ids;
  const cur = raw.currency;
  const accountCurrency = cur === 'SAR' || cur === 'USD' ? cur : undefined;
  return {
    ...(raw as Record<string, unknown>),
    id: String(id),
    user_id: raw.user_id as string | undefined,
    name: name || (id ? `Account ${String(id).slice(0, 8)}` : 'Account'),
    type,
    balance,
    currency: accountCurrency,
    owner: raw.owner as string | undefined,
    linkedAccountIds: Array.isArray(linkedAccountIds)
      ? linkedAccountIds.filter((x): x is string => typeof x === 'string')
      : undefined,
    platformDetails: raw.platformDetails ?? raw.platform_details,
  } as Account;
}

function digestNormalizeAsset(raw: Record<string, unknown>): Asset {
  const pp = raw.purchase_price ?? raw.purchasePrice;
  const mr = raw.monthly_rent ?? raw.monthlyRent;
  const issueRaw = raw.issue_date ?? raw.issueDate;
  const matRaw = raw.maturity_date ?? raw.maturityDate;
  const issueDate =
    issueRaw != null && String(issueRaw).trim() !== '' ? String(issueRaw).trim().slice(0, 10) : undefined;
  const maturityDate =
    matRaw != null && String(matRaw).trim() !== '' ? String(matRaw).trim().slice(0, 10) : undefined;
  const notesRaw = raw.notes;
  const notes = notesRaw != null && String(notesRaw).trim() !== '' ? String(notesRaw) : undefined;
  return {
    ...(raw as object),
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    type: raw.type as Asset['type'],
    value: roundMoney(Number(raw.value ?? 0)),
    purchasePrice: pp != null && pp !== '' ? roundMoney(Number(pp)) : undefined,
    isRental: raw.is_rental ?? raw.isRental,
    monthlyRent: mr != null && mr !== '' ? roundMoney(Number(mr)) : undefined,
    goalId: raw.goal_id ?? raw.goalId,
    owner: raw.owner as string | undefined,
    issueDate,
    maturityDate,
    notes,
  } as Asset;
}

function digestNormalizeLiability(raw: Record<string, unknown>): Liability {
  const type = (raw.type === 'Receivable' ? 'Receivable' : raw.type) as Liability['type'];
  const rawAmount = roundMoney(Number(raw.amount ?? 0));
  const amount = type === 'Receivable' ? Math.abs(rawAmount) : -Math.abs(rawAmount);
  return {
    ...(raw as object),
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    status: (raw.status === 'Paid' ? 'Paid' : 'Active') as Liability['status'],
    type,
    amount: roundMoney(amount),
    goalId: raw.goalId ?? raw.goal_id,
    owner: raw.owner as string | undefined,
  } as Liability;
}

function digestNormalizeHolding(holding: Record<string, unknown>): Holding {
  const holdingType = (holding.holdingType ?? holding.holding_type ?? 'ticker') as string;
  return {
    ...holding,
    id: String(holding.id ?? ''),
    user_id: holding.user_id as string | undefined,
    portfolio_id: (holding.portfolio_id || holding.portfolioId) as string | undefined,
    symbol: String(holding.symbol ?? ''),
    holdingType,
    quantity: roundQuantity(Number(holding.quantity ?? 0)),
    avgCost: roundAvgCostPerUnit(Number(holding.avgCost ?? holding.avg_cost ?? 0)),
    currentValue: roundMoney(Number(holding.currentValue ?? holding.current_value ?? 0)),
    goalId: holding.goalId ?? holding.goal_id,
    assetClass: holding.assetClass ?? holding.asset_class,
    realizedPnL: roundMoney(Number(holding.realizedPnL ?? holding.realized_pnl ?? 0)),
    dividendDistribution: holding.dividendDistribution ?? holding.dividend_distribution,
    dividendYield: holding.dividendYield ?? holding.dividend_yield,
    zakahClass: (holding.zakahClass ?? holding.zakah_class ?? 'Zakatable') as Holding['zakahClass'],
    acquisitionDate: holding.acquisitionDate ?? holding.acquisition_date,
  } as Holding;
}

function digestNormalizeCommodity(holding: Record<string, unknown>): CommodityHolding {
  const name = holding.name ?? holding.Name;
  const trimmed = String(name ?? '').trim();
  const base = {
    id: String(holding.id ?? ''),
    user_id: holding.user_id as string | undefined,
    symbol: String(holding.symbol ?? ''),
    unit: (['gram', 'ounce', 'BTC', 'unit'].includes(String(holding.unit))
      ? (holding.unit as CommodityHolding['unit'])
      : 'unit') as CommodityHolding['unit'],
  };
  if (!trimmed) {
    return {
      ...base,
      ...holding,
      name: 'Other',
      quantity: roundQuantity(Number(holding.quantity ?? 0)),
      purchaseValue: roundMoney(Number(holding.purchaseValue ?? holding.purchase_value ?? holding.purchasevalue ?? 0)),
      currentValue: roundMoney(Number(holding.currentValue ?? holding.current_value ?? holding.currentvalue ?? 0)),
      goldKarat: (holding.goldKarat ?? holding.gold_karat ?? (String(holding.symbol || '').match(/_(24|22|21|18)K$/)?.[1]
        ? Number(String(holding.symbol || '').match(/_(24|22|21|18)K$/)?.[1])
        : undefined)) as CommodityHolding['goldKarat'],
      zakahClass: (holding.zakahClass ?? holding.zakah_class ?? holding.zakahclass ?? 'Zakatable') as CommodityHolding['zakahClass'],
      goalId: holding.goalId ?? holding.goal_id,
      acquisitionDate: holding.acquisitionDate ?? holding.acquisition_date,
      createdAt: holding.createdAt ?? holding.created_at,
    } as CommodityHolding;
  }
  const allowedNames = ['Gold', 'Silver', 'Bitcoin'] as const;
  const validName =
    allowedNames.find((a) => a.toLowerCase() === trimmed.toLowerCase()) ?? 'Other';
  return {
    ...base,
    ...holding,
    name: validName,
    quantity: roundQuantity(Number(holding.quantity ?? 0)),
    purchaseValue: roundMoney(Number(holding.purchaseValue ?? holding.purchase_value ?? holding.purchasevalue ?? 0)),
    currentValue: roundMoney(Number(holding.currentValue ?? holding.current_value ?? holding.currentvalue ?? 0)),
    goldKarat: (holding.goldKarat ?? holding.gold_karat ?? (String(holding.symbol || '').match(/_(24|22|21|18)K$/)?.[1]
      ? Number(String(holding.symbol || '').match(/_(24|22|21|18)K$/)?.[1])
      : undefined)) as CommodityHolding['goldKarat'],
    zakahClass: (holding.zakahClass ?? holding.zakah_class ?? holding.zakahclass ?? 'Zakatable') as CommodityHolding['zakahClass'],
    goalId: holding.goalId ?? holding.goal_id,
    acquisitionDate: holding.acquisitionDate ?? holding.acquisition_date,
    createdAt: holding.createdAt ?? holding.created_at,
  } as CommodityHolding;
}

function digestNormalizeInvestmentTransaction(
  transaction: Record<string, unknown>,
  accounts: Account[],
  investments: InvestmentPortfolio[],
): InvestmentTransaction {
  const curRaw = transaction.currency as string | undefined;
  const currency = curRaw === 'SAR' || curRaw === 'USD' ? curRaw : undefined;
  const typeRaw = String(transaction.type ?? '').toLowerCase();
  const portfolioId = transaction.portfolioId ?? transaction.portfolio_id;
  const linkedPortfolio = portfolioId ? investments.find((p) => p.id === portfolioId) : undefined;
  const portfolioLinkedAccountId = portfolioId
    ? resolveAccountId(
        linkedPortfolio?.accountId ?? (linkedPortfolio as { account_id?: string })?.account_id,
        accounts,
      )
    : undefined;
  return {
    ...transaction,
    accountId: transaction.accountId || transaction.account_id || portfolioLinkedAccountId,
    portfolioId: portfolioId as string | undefined,
    type: typeRaw as InvestmentTransaction['type'],
    currency,
    linkedCashAccountId: transaction.linkedCashAccountId ?? transaction.linked_cash_account_id,
  } as InvestmentTransaction;
}

function mapPortfolio(portfolio: Record<string, unknown>, accounts: Account[]): InvestmentPortfolio {
  const rawAccountId = portfolio.accountId || portfolio.account_id;
  const resolved = resolveAccountId(rawAccountId as string | undefined, accounts) ?? (rawAccountId as string);
  const holdings = ((portfolio.holdings as Record<string, unknown>[]) || []).map(digestNormalizeHolding);
  const id = String(portfolio.id ?? '');
  const currency = resolveInvestmentPortfolioCurrency({
    ...(portfolio as object),
    id,
    name: String(portfolio.name ?? ''),
    accountId: resolved,
    holdings,
  } as InvestmentPortfolio);
  return {
    ...(portfolio as object),
    id,
    name: String(portfolio.name ?? ''),
    accountId: resolved,
    goalId: portfolio.goal_id ?? portfolio.goalId,
    currency,
    holdings,
    owner: portfolio.owner as string | undefined,
  } as InvestmentPortfolio;
}

export type WeeklyDigestFinanceRows = {
  accountsRaw: Record<string, unknown>[];
  assetsRaw: Record<string, unknown>[];
  liabilitiesRaw: Record<string, unknown>[];
  /** `investment_portfolios` rows with nested `holdings(*)`. */
  portfoliosRaw: Record<string, unknown>[];
  commodityHoldingsRaw: Record<string, unknown>[];
  investmentTransactionsRaw: Record<string, unknown>[];
  wealthUltraUserRow: Record<string, unknown> | null;
  wealthUltraGlobalRow: Record<string, unknown> | null;
};

/**
 * Build a minimal `FinancialData` for server-side net worth — same shape the app uses for balance-sheet math.
 */
export function buildFinancialDataForWeeklyDigest(rows: WeeklyDigestFinanceRows): FinancialData {
  const accounts = (rows.accountsRaw ?? []).map(digestNormalizeAccount);
  let wealthUltraConfig = getDefaultWealthUltraSystemConfig();
  if (rows.wealthUltraUserRow) {
    wealthUltraConfig = mergeWealthUltraSystemConfigFromRow(rows.wealthUltraUserRow, wealthUltraConfig);
  } else if (rows.wealthUltraGlobalRow) {
    wealthUltraConfig = mergeWealthUltraSystemConfigFromRow(rows.wealthUltraGlobalRow, wealthUltraConfig);
  }
  const investments = (rows.portfoliosRaw ?? []).map((p) => mapPortfolio(p, accounts));
  const investmentTransactions = (rows.investmentTransactionsRaw ?? []).map((t) =>
    digestNormalizeInvestmentTransaction(t, accounts, investments),
  );

  return {
    accounts,
    assets: (rows.assetsRaw ?? []).map(digestNormalizeAsset),
    liabilities: (rows.liabilitiesRaw ?? []).map(digestNormalizeLiability),
    goals: [],
    transactions: [],
    recurringTransactions: [],
    investments,
    investmentTransactions,
    budgets: [],
    commodityHoldings: (rows.commodityHoldingsRaw ?? []).map(digestNormalizeCommodity),
    watchlist: [],
    settings: { riskProfile: 'Moderate', budgetThreshold: 90, driftThreshold: 5, enableEmails: true, goldPrice: 275, monthStartDay: 1 },
    zakatPayments: [],
    priceAlerts: [],
    plannedTrades: [],
    notifications: [],
    investmentPlan: {
      monthlyBudget: 0,
      budgetCurrency: 'SAR',
      executionCurrency: 'USD',
      fxRateSource: 'GoogleFinance:CURRENCY:SARUSD',
      coreAllocation: 0.7,
      upsideAllocation: 0.3,
      minimumUpsidePercentage: 25,
      stale_days: 5,
      min_coverage_threshold: 3,
      redirect_policy: 'priority',
      target_provider: 'Finnhub',
      corePortfolio: [],
      upsideSleeve: [],
      brokerConstraints: {
        allowFractionalShares: false,
        minimumOrderSize: 1,
        roundingRule: 'round',
        leftoverCashRule: 'hold',
      },
    },
    portfolioUniverse: [],
    statusChangeLog: [],
    executionLogs: [],
    allTransactions: [],
    allBudgets: [],
    wealthUltraConfig,
    budgetRequests: [],
    sukukPayoutSchedules: [],
    sukukPayoutEvents: [],
  };
}
