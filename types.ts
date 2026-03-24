





export type Page = 'Dashboard' | 'Summary' | 'Accounts' | 'Goals' | 'Liabilities' | 'Transactions' | 'Budgets' | 'Analysis' | 'Forecast' | 'Zakat' | 'Notifications' | 'Settings' | 'Investments' | 'Plan' | 'Wealth Ultra' | 'Market Events' | 'Recovery Plan' | 'Investment Plan' | 'Dividend Tracker' | 'AI Rebalancer' | 'Watchlist' | 'Assets' | 'System & APIs Health' | 'Statement Upload' | 'Statement History' | 'Commodities' | 'Engines & Tools';

export type UserRole = 'Admin' | 'Restricted';
export type ApprovalStatus = 'Pending' | 'Approved' | 'Rejected';

/** Account role for cash allocation and sweep logic (logic layer). */
export type AccountRole =
  | 'operating_cash'
  | 'salary_receiving'
  | 'bills_payment'
  | 'emergency_reserve'
  | 'investment_funding'
  | 'trading_capital'
  | 'long_term_savings'
  | 'goal_reserve'
  | 'debt_servicing';

/** Bucket type for cash separation (operating vs investable etc.). */
export type AccountBucketType = 'operating' | 'reserve' | 'provision' | 'goal' | 'investable';

/** Transaction type for classification and reporting (logic layer). */
export type TransactionType =
  | 'income'
  | 'transfer'
  | 'expense'
  | 'investment_buy'
  | 'investment_sell'
  | 'dividend'
  | 'interest'
  | 'fee'
  | 'refund'
  | 'debt_payment'
  | 'goal_contribution'
  | 'goal_withdrawal'
  | 'adjustment'
  | 'fx_conversion'
  | 'cash_deposit'
  | 'cash_withdrawal';

/** Profile fields for logic (base currency, timezone, etc.). Can be backed by Settings or a profile table later. */
export interface Profile {
  baseCurrency?: 'SAR' | 'USD';
  timezone?: string;
  riskProfile?: RiskProfile;
  investmentStyle?: string;
  familySize?: number;
  salaryCycle?: 'monthly' | 'bi-weekly' | 'annual';
}

export interface Goal {
  id: string;
  user_id?: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  deadline: string;
  savingsAllocationPercent?: number;
  priority?: 'High' | 'Medium' | 'Low';
}

export interface Account {
  id:string;
  user_id?: string;
  name: string;
  type: 'Checking' | 'Savings' | 'Investment' | 'Credit';
  balance: number;
  /** Denomination of `balance` and transfer amounts for Checking/Savings (defaults via investment plan / SAR). */
  currency?: 'USD' | 'SAR';
  owner?: string;
  /** For Investment accounts: linked cash account IDs that can fund this platform */
  linkedAccountIds?: string[];
  platformDetails?: {
    features: string[];
    assetTypes: string[];
    fees: string;
  };
}

export type AssetType =
  | 'Cash'
  | 'Sukuk'
  | 'Property' // Residential/Commercial
  | 'Land'
  | 'Vehicle'
  | 'Jewelry'
  | 'Artworks and collectibles'
  | 'Islamic finance instruments' // Murabaha, etc.
  | 'Accounts receivable'
  | 'Household Goods'
  | 'Electronics'
  | 'Other';

export interface Asset {
  id: string;
  user_id?: string;
  name: string;
  type: AssetType;
  value: number;
  purchasePrice?: number;
  isRental?: boolean;
  monthlyRent?: number;
  goalId?: string;
  owner?: string;
  /** Sukuk / dated instruments: issue (or subscription) date, ISO `YYYY-MM-DD`. */
  issueDate?: string;
  /** Sukuk / dated instruments: maturity date, ISO `YYYY-MM-DD`. */
  maturityDate?: string;
  /** Free-form details (location, deed ref, insurance, condition, etc.). */
  notes?: string;
}

export interface Liability {
  id: string;
  user_id?: string;
  name: string;
  type: 'Mortgage' | 'Loan' | 'Credit Card' | 'Personal Loan' | 'Receivable';
  amount: number;
  status: 'Active' | 'Paid';
  goalId?: string;
  owner?: string;
}

export interface Transaction {
  id: string;
  user_id?: string;
  date: string;
  description: string;
  amount: number;
  category: string; // Specific expense category e.g. "Groceries"
  accountId: string; // Link to the account
  budgetCategory?: string; // Broader budget group e.g. "Food and Groceries"
  subcategory?: string;
  type: 'income' | 'expense';
  transactionNature?: 'Fixed' | 'Variable';
  expenseType?: 'Core' | 'Discretionary';
  status?: ApprovalStatus;
  categoryId?: string;
  note?: string;
  rejectionReason?: string;
  /** Set when transaction was auto-created from a recurring rule. */
  recurringId?: string;
  /** Optional link to the financial statement (e.g. bank/trading) this transaction was imported from. */
  statementId?: string;
  /** Parsed from note (see transactionSplitNote); not a separate DB column. */
  splitLines?: { category: string; amount: number }[];
}

export type HoldingAssetClass =
  | 'Stock' // Tadawul, International
  | 'Sukuk' // Islamic Bond
  | 'Mutual Fund'
  | 'ETF'
  | 'REIT'
  | 'Cryptocurrency'
  | 'Commodity' // Oil, Metals
  | 'CD' // Certificate of Deposit
  | 'Private Equity'
  | 'Venture Capital'
  | 'Savings Bond'
  | 'NFT'
  | 'Other';

/** Allowed `holdings.asset_class` values (Supabase check + app). Keep in sync with migrations. */
export const HOLDING_ASSET_CLASS_OPTIONS: readonly HoldingAssetClass[] = [
  'Stock',
  'Sukuk',
  'Mutual Fund',
  'ETF',
  'REIT',
  'Cryptocurrency',
  'Commodity',
  'CD',
  'Private Equity',
  'Venture Capital',
  'Savings Bond',
  'NFT',
  'Other',
];

export interface Holding {
  id: string; 
  user_id?: string;
  portfolio_id?: string;
  symbol: string;
  name?: string;
  quantity: number;
  avgCost: number;
  currentValue: number;
  goalId?: string;
  assetClass?: HoldingAssetClass;
  percentage?: number;
  zakahClass: 'Zakatable' | 'Non-Zakatable';
  realizedPnL: number;
  dividendDistribution?: 'Reinvest' | 'Payout';
  dividendYield?: number;
  /** DB/schema: 'ticker' | 'manual_fund' etc. Used when persisting to backend. */
  holdingType?: string;
}

export interface InvestmentPortfolio {
  id: string;
  user_id?: string;
  name: string;
  accountId: string;
  /** Base currency for this portfolio (all holding values are in this currency). If unset, inferred from holdings (Tadawul *.SR/*.SA ⇒ SAR). */
  currency?: TradeCurrency;
  holdings: Holding[];
  goalId?: string;
  owner?: string;
}

export type TradeCurrency = 'USD' | 'SAR';

export interface InvestmentTransaction {
  id: string;
  user_id?: string;
  accountId: string;
  date: string;
  type: 'buy' | 'sell' | 'dividend' | 'deposit' | 'withdrawal';
  symbol: string;
  quantity: number;
  price: number;
  total: number;
  /** Currency the trade was recorded in (display & reporting). */
  currency?: TradeCurrency;
  /** For deposits/withdrawals: the linked cash account ID (source for deposits, destination for withdrawals) */
  linkedCashAccountId?: string;
}

/** Budget tier: Core (essential), Supporting (important), Optional (discretionary). */
export type BudgetTier = 'Core' | 'Supporting' | 'Optional';

export interface Budget {
  id: string;
  user_id?: string;
  category: string;
  limit: number;
  month: number; // 1-12
  year: number;
  /** When 'yearly', limit is total per year. When 'weekly'/'daily', limit is per week/day. When missing or 'monthly', limit is per month. */
  period?: 'monthly' | 'yearly' | 'weekly' | 'daily';
  /** Type of budget: Core (essential), Supporting, or Optional. Used for prioritization and display. */
  tier?: BudgetTier;
  /** Optional: account ID to route surplus/deficit for this budget (e.g. savings account). */
  destinationAccountId?: string;
}


export interface GovernanceUser {
  id: string;
  name: string;
  role: UserRole;
}

export interface BudgetCategory {
  id: string;
  name: string;
  monthlyLimit: number;
  totalSpent: number;
}

export interface CategoryPermission {
  userId: string;
  categoryId: string;
}

export interface BudgetRequest {
  id: string;
  userId: string;
  requestType: 'NewCategory' | 'IncreaseLimit';
  categoryId?: string;
  categoryName?: string;
  amount: number;
  note?: string;
  status: 'Pending' | 'Finalized' | 'Rejected';
}

export interface CommodityHolding {
  id: string;
  user_id?: string;
  name: 'Gold' | 'Silver' | 'Bitcoin' | 'Other';
  quantity: number;
  unit: 'gram' | 'ounce' | 'BTC' | 'unit';
  /** Gold purity in karat (required for gold valuation). */
  goldKarat?: 24 | 22 | 21 | 18;
  purchaseValue: number;
  currentValue: number;
  symbol: string; // e.g., XAU_GRAM_24K, BTC_USD
  zakahClass: 'Zakatable' | 'Non-Zakatable';
  owner?: string;
  goalId?: string;
}

export interface WatchlistItem {
    user_id?: string;
    symbol: string;
    name: string;
}

export type RiskProfile = 'Conservative' | 'Moderate' | 'Aggressive';

export interface Settings {
    user_id?: string;
    riskProfile: RiskProfile;
    budgetThreshold: number; // e.g., 90%
    driftThreshold: number; // e.g., 5%
    enableEmails: boolean;
    goldPrice: number;
    /** Optional: nisab amount override (e.g. in SAR). When set, Zakat uses this instead of goldPrice * 85. */
    nisabAmount?: number;
}

export interface ZakatPayment {
    id: string;
    user_id?: string;
    date: string;
    amount: number;
    notes?: string;
}

export type PriceAlertCurrency = 'USD' | 'SAR';

export interface PriceAlert {
  id: string;
  user_id?: string;
  symbol: string;
  targetPrice: number;
  /** Currency for the target price (selected when adding the alert). */
  currency?: PriceAlertCurrency;
  status: 'active' | 'triggered';
  createdAt: string;
}

export interface Notification {
  id: string;
  user_id?: string;
  type: 'system' | 'alert' | 'update';
  message: string;
  read: boolean;
  createdAt: string;
  link?: string;
}

export interface PlannedTrade {
  id: string;
  user_id?: string;
  symbol: string;
  name: string;
  tradeType: 'buy' | 'sell';
  conditionType: 'price' | 'date';
  targetValue: number; // Price or Date timestamp
  quantity?: number;
  amount?: number; // in SAR
  priority: 'High' | 'Medium' | 'Low';
  status: 'Planned' | 'Executed';
  notes?: string;
}

/** Template for monthly recurring transactions (e.g. salary deposit, rent). */
export interface RecurringTransaction {
  id: string;
  user_id?: string;
  description: string;
  amount: number; // positive; type determines income vs expense
  type: 'income' | 'expense';
  accountId: string;
  budgetCategory?: string;
  category: string;
  /** Day of month (1–28) when the transaction should be created. */
  dayOfMonth: number;
  enabled: boolean;
  /** When true, do not auto-record on the day; user must apply manually from Transactions. When false (default), system records on dayOfMonth automatically. */
  addManually?: boolean;
}

export interface FinancialData {
  accounts: Account[];
  assets: Asset[];
  liabilities: Liability[];
  goals: Goal[];
  transactions: Transaction[];
  recurringTransactions: RecurringTransaction[];
  investments: InvestmentPortfolio[];
  investmentTransactions: InvestmentTransaction[];
  budgets: Budget[];
  commodityHoldings: CommodityHolding[];
  watchlist: WatchlistItem[];
  settings: Settings;
  zakatPayments: ZakatPayment[];
  priceAlerts: PriceAlert[];
  plannedTrades: PlannedTrade[];
  investmentPlan: InvestmentPlanSettings;
  /** Wealth Ultra default parameters from app settings/config only (not from DB). */
  wealthUltraConfig?: WealthUltraSystemConfig | null;
  portfolioUniverse: UniverseTicker[];
  statusChangeLog: StatusChangeLog[];
  executionLogs: InvestmentPlanExecutionLog[];
  notifications: Notification[];
  /** Admin-only: All users' transactions for approval notifications */
  allTransactions?: Transaction[];
  /** Admin-only: All users' budgets for tracking */
  allBudgets?: Budget[];
  /** Budget requests (e.g. new category / increase limit) for governance */
  budgetRequests?: BudgetRequest[];
  /** Personal wealth only (owner empty): use for "my" net worth and KPIs. Populated by DataContext. */
  personalAccounts?: Account[];
  personalAssets?: Asset[];
  personalLiabilities?: Liability[];
  personalInvestments?: InvestmentPortfolio[];
  personalCommodityHoldings?: CommodityHolding[];
  /** Transactions that hit personal accounts only (for "my" income/expense). */
  personalTransactions?: Transaction[];
}

/**
 * Financial data as provided by DataContext: personal* arrays are always populated.
 * Use this type when you know the source is DataContext (e.g. context.data) so "my" metrics use personal* directly.
 */
export type DataContextFinancialData = FinancialData & {
  personalAccounts: Account[];
  personalAssets: Asset[];
  personalLiabilities: Liability[];
  personalInvestments: InvestmentPortfolio[];
  personalCommodityHoldings: CommodityHolding[];
  personalTransactions: Transaction[];
};

export interface KPISummary {
  netWorth: number;
  liquidNetWorth: number;
  assetMix: { name: string; value: number }[];
  liabilitiesCoverage: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  monthlyPnL: number;
  budgetVariance: number;
  roi: number;
}

export interface FeedItem {
    type: 'BUDGET' | 'GOAL' | 'INVESTMENT' | 'SAVINGS';
    title: string;
    description: string;
    emoji: string;
}

export interface ReportCardItem {
    metric: string;
    value: string;
    rating: 'Excellent' | 'Good' | 'Needs Improvement';
    analysis: string;
    suggestion: string;
}

export interface PersonaAnalysis {
    persona: {
        title: string;
        description: string;
    };
    reportCard: ReportCardItem[];
}

// --- Investment Plan Types ---

export interface CorePortfolioDefinition {
  ticker: string;
  weight: number; // e.g., 0.5 for 50%
}

export interface UpsideSleeveDefinition {
  ticker: string;
  weight: number; // e.g., 0.25 for 25%
}

export interface BrokerConstraints {
    allowFractionalShares: boolean;
    minimumOrderSize: number;
    roundingRule: 'round' | 'floor' | 'ceil';
    leftoverCashRule: 'reinvest_core' | 'hold';
}

/** General sleeve definition from the system (not code-specific). */
export interface SleeveDefinition {
  id: string;
  label: string;
  targetPct: number;
  tickers: string[];
}

export interface InvestmentPlanSettings {
  user_id?: string;
  monthlyBudget: number;
  budgetCurrency: 'SAR';
  executionCurrency: 'USD';
  fxRateSource: string; // e.g., 'GoogleFinance:CURRENCY:SARUSD'
  coreAllocation: number; // e.g., 0.7 for 70%
  upsideAllocation: number; // e.g., 0.3 for 30%
  minimumUpsidePercentage: number; // e.g., 25 for 25%
  stale_days: number;
  min_coverage_threshold: number;
  redirect_policy: 'priority' | 'pro-rata';
  target_provider: string;
  corePortfolio: CorePortfolioDefinition[];
  upsideSleeve: UpsideSleeveDefinition[];
  /** General sleeve definitions from system. If set, used instead of core/upside/spec split. */
  sleeves?: SleeveDefinition[] | null;
  brokerConstraints: BrokerConstraints;
  /** Set when user saves monthly plan (DB + notifications for FX freshness). */
  fxRateUpdatedAt?: string | null;
}

/** Wealth Ultra default parameters (from app settings/config, not DB). General share/sleeve config. */
export interface WealthUltraSystemConfig {
  fxRate: number;
  cashReservePct: number;
  maxPerTickerPct: number;
  riskWeightLow: number;
  riskWeightMed: number;
  riskWeightHigh: number;
  riskWeightSpec: number;
  defaultTarget1Pct: number;
  defaultTarget2Pct: number;
  defaultTrailingPct: number;
}

export interface ProposedTrade {
    ticker: string;
    /** Amount in plan currency (used for totals/logs). */
    amount: number;
    /** Trade currency of the underlying share/portfolio for this ticker. */
    tradeCurrency?: TradeCurrency;
    /** Optional converted amount in the trade currency (if different from plan currency). */
    amountInTradeCurrency?: number;
    reason: 'Core' | 'Upside' | 'Speculative' | 'Redirected' | 'Rebalance' | 'Unused Upside Funds' | 'Leftover';
}

export interface InvestmentPlanExecutionResult {
    date: string;
    totalInvestment: number;
    coreInvestment: number;
    upsideInvestment: number;
    speculativeInvestment: number;
    redirectedInvestment: number;
    unusedUpsideFunds: number;
    trades: ProposedTrade[];
    status: 'success' | 'failure';
    log_details: string;
}

export interface InvestmentPlanExecutionLog extends InvestmentPlanExecutionResult {
    id: string;
    user_id: string;
    created_at: string;
    status: 'success' | 'failure';
    log_details: string; // Can be a stringified JSON of the result or an error message
}

export type TickerStatus = 'Core' | 'High-Upside' | 'Watchlist' | 'Quarantine' | 'Speculative' | 'Excluded';

export interface UniverseTicker {
  id: string;
  user_id?: string;
  ticker: string;
  name: string;
  status: TickerStatus;
  monthly_weight?: number; // Used for Core, High-Upside, Speculative
  max_position_weight?: number; // Risk cap
  min_upside_threshold_override?: number;
  min_coverage_override?: number;
}

export interface StatusChangeLog {
    id: string;
    user_id?: string;
    ticker: string;
    timestamp: string;
    from_status: TickerStatus;
    to_status: TickerStatus;
}

// --- Wealth Ultra Portfolio Engine ---

export type WealthUltraSleeve = 'Core' | 'Upside' | 'Spec';
export type WealthUltraRiskTier = 'Low' | 'Med' | 'High' | 'Spec';
export type WealthUltraStrategyMode = 'Hold' | 'Adjust' | 'DipBuy' | 'Trim' | 'Exit';

export interface WealthUltraConfig {
  fxRate: number;
  targetCorePct: number;
  targetUpsidePct: number;
  targetSpecPct: number;
  defaultTarget1Pct: number;
  defaultTarget2Pct: number;
  defaultTrailingPct: number;
  monthlyDeposit: number;
  cashAvailable: number;
  cashReservePct: number;
  maxPerTickerPct: number;
  riskWeightLow: number;
  riskWeightMed: number;
  riskWeightHigh: number;
  riskWeightSpec: number;
  /** Ticker lists from system (e.g. investment_plan); general config, not hardcoded. */
  coreTickers?: string[];
  upsideTickers?: string[];
  specTickers?: string[];
  /** From Settings: rebalancing alert when sleeve drifts from target by more than this %. Default 5. */
  driftAlertPct?: number;
}

export interface WealthUltraPosition {
  ticker: string;
  sleeveType: WealthUltraSleeve;
  riskTier: WealthUltraRiskTier;
  strategyMode: WealthUltraStrategyMode;
  /** Composite 0–100 risk score based on volatility, drawdown, and concentration; higher = riskier. */
  riskScore?: number;
  currentShares: number;
  avgCost: number;
  currentPrice: number;
  marketValue: number;
  plDollar: number;
  plPct: number;
  buy1Qty?: number;
  buy1Price?: number;
  buy2Qty?: number;
  buy2Price?: number;
  buy3Qty?: number;
  buy3Price?: number;
  plannedAddedShares?: number;
  plannedAddedCost?: number;
  newTotalShares?: number;
  newAvgCost?: number;
  target1PctOverride?: number;
  applyTarget1: boolean;
  target1Price?: number;
  target2PctOverride?: number;
  applyTarget2: boolean;
  target2Price?: number;
  trailingPctOverride?: number;
  applyTrailing: boolean;
  trailingStopPrice?: number;
}

export interface WealthUltraSleeveAllocation {
  sleeve: WealthUltraSleeve;
  marketValue: number;
  allocationPct: number;
  targetPct: number;
  driftPct: number;
}

export interface WealthUltraOrder {
  type: 'BUY' | 'SELL';
  ticker: string;
  qty?: number;
  limitPrice?: number;
  orderType: 'LIMIT';
  tif: 'GTC';
  target1Price?: number;
  target2Price?: number;
  trailingStopPrice?: number;
  /** Optional engine priority score (higher = more impact per unit of capital). */
  priorityScore?: number;
  /** Short human-readable explanation for why this order exists. */
  rationale?: string;
}

export type WealthUltraAlertType =
  | 'sleeve_drift'            // over or under target
  | 'sleeve_overweight'
  | 'spec_breach'
  | 'max_per_ticker_breach'
  | 'over_budget'
  | 'position_trim_suggest'   // > +40%
  | 'position_risk_review'    // < -30%
  | 'dip_buy_opportunity'     // Core/Upside down 15%+ (DipBuy mode)
  | 'deployment_opportunity'  // monthly Core deploy has suggested ticker
  | 'cash_reserve_low'        // deployable below reserve
  | 'concentration_risk'      // top tickers too high % of portfolio
  | 'spec_loss_review'        // Spec position large loss
  | 'trailing_stop_near'      // price near trailing stop
  | 'underperformer_review'   // worst capital efficiency — review holdings
  | 'cash_deploy_prompt'      // deployable cash + Core under target
  | 'portfolio_stress'        // many positions in meaningful loss
  | 'portfolio_on_track';     // positive: allocation on target, no critical issues

export type WealthUltraAlertSeverity = 'critical' | 'warning' | 'info';

export interface WealthUltraAlert {
  type: WealthUltraAlertType;
  message: string;
  /** Short actionable suggestion for the user. */
  actionHint?: string;
  /** Optional short title for UI (e.g. "Rebalance", "Opportunity"). */
  title?: string;
  /** critical = act soon; warning = review; info = opportunity or FYI. */
  severity?: WealthUltraAlertSeverity;
  ticker?: string;
  /** For grouped alerts (e.g. multiple trim candidates). */
  tickers?: string[];
  sleeve?: WealthUltraSleeve;
  value?: number;
}

// --- Recovery Plan (Averaging / Correction Engine) ---

export type RecoveryPlanState =
  | 'NORMAL'      // no action
  | 'WATCH'       // down but not triggered
  | 'QUALIFIED'   // loss crossed trigger; recovery allowed
  | 'PLANNED'     // ladder created + exits generated
  | 'PARTIAL_FILL'// some ladder filled → recompute avg + exits
  | 'READY_TO_EXIT'// price reached target → suggest sell
  | 'CLOSED'      // position reduced/closed
  | 'FROZEN';     // blocked (spec breach / cash shortage / rule breach)

/** Per-position recovery config (stored or derived). */
export interface RecoveryPositionConfig {
  symbol: string;
  recoveryEnabled: boolean;
  lossTriggerPct: number;       // e.g. 20 → qualifies when loss >= 20%
  cashCap: number;              // max money allowed for correction on this ticker
  maxAddShares?: number;
  maxAddCost?: number;
  sleeveType: WealthUltraSleeve;
  riskTier: WealthUltraRiskTier;
}

/** One level in the buy ladder. */
export interface RecoveryLadderLevel {
  level: 1 | 2 | 3;
  qty: number;
  price: number;
  cost: number;
  weightPct?: number;
}

/** Exit targets (optional toggles). */
export interface RecoveryExitPlan {
  applyTarget1: boolean;
  target1Pct: number;
  target1Price?: number;
  applyTarget2: boolean;
  target2Pct: number;
  target2Price?: number;
  applyTrailing: boolean;
  trailPct: number;
  trailStopPrice?: number;
}

/** Global config for recovery plan. */
export interface RecoveryGlobalConfig {
  deployableCash: number;
  reservePct: number;
  maxPerTickerPct: number;
  maxPerTickerCost?: number;
  recoveryBudgetPct: number;    // e.g. 0.2 = 20% of deployable for recovery
  specFreezeRules: boolean;    // when true, SPEC recovery blocked unless override
  minDeployableThreshold: number;
  /** Ladder step multipliers below current price (e.g. [0.07, 0.12, 0.18] = 7%, 12%, 18%). */
  ladderStepsByRisk: Record<WealthUltraRiskTier, [number, number, number]>;
  /** Level weights for allocating budget (e.g. [0.4, 0.35, 0.25]). */
  ladderWeights: [number, number, number];
}

/** Full recovery plan for one position. */
export interface RecoveryPlanResult {
  symbol: string;
  state: RecoveryPlanState;
  qualified: boolean;
  reason?: string;
  costBasis: number;
  marketValue: number;
  plUsd: number;
  plPct: number;
  currentPrice: number;
  shares: number;
  avgCost: number;
  ladder: RecoveryLadderLevel[];
  totalPlannedCost: number;
  newShares: number;
  newAvgCost: number;
  exitPlan: RecoveryExitPlan;
  budgetImpact: number;
  capCheckOk: boolean;
}

/** Draft order for broker/execution. */
export interface RecoveryOrderDraft {
  type: 'BUY' | 'SELL';
  symbol: string;
  qty: number;
  limitPrice: number;
  orderType: 'LIMIT';
  target1Price?: number;
  target2Price?: number;
  trailingStopPrice?: number;
  label?: string;
}
