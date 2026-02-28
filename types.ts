





export type Page = 'Dashboard' | 'Summary' | 'Accounts' | 'Goals' | 'Investments' | 'Assets' | 'Liabilities' | 'Transactions' | 'Budgets' | 'Plan' | 'Analysis' | 'Forecast' | 'Zakat' | 'Notifications' | 'System & APIs Health' | 'Settings' | 'Wealth Ultra';

export type UserRole = 'Admin' | 'Restricted';
export type ApprovalStatus = 'Pending' | 'Approved' | 'Rejected';

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
  owner?: string;
  platformDetails?: {
    features: string[];
    assetTypes: string[];
    fees: string;
  };
}

export type AssetType =
  | 'Cash'
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
}

export interface Liability {
  id: string;
  user_id?: string;
  name: string;
  type: 'Mortgage' | 'Loan' | 'Credit Card' | 'Personal Loan';
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
}

export interface InvestmentPortfolio {
  id: string;
  user_id?: string;
  name: string;
  accountId: string;
  holdings: Holding[];
  goalId?: string;
  owner?: string;
}

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
  /** When 'yearly', limit is the total per year (e.g. housing). When missing or 'monthly', limit is per month. */
  period?: 'monthly' | 'yearly';
  /** Type of budget: Core (essential), Supporting, or Optional. Used for prioritization and display. */
  tier?: BudgetTier;
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
  purchaseValue: number;
  currentValue: number;
  symbol: string; // e.g., GOLD_GRAM, BTC_USD
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

export interface PriceAlert {
  id: string;
  user_id?: string;
  symbol: string;
  targetPrice: number;
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
  /** System-wide Wealth Ultra defaults (from wealth_ultra_config). General share/sleeve config. */
  wealthUltraConfig?: WealthUltraSystemConfig | null;
  portfolioUniverse: UniverseTicker[];
  statusChangeLog: StatusChangeLog[];
  executionLogs: InvestmentPlanExecutionLog[];
  notifications: Notification[];
}

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
}

/** Wealth Ultra numeric config from system (wealth_ultra_config table). General, not code-specific. */
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
    amount: number;
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
}

export interface WealthUltraPosition {
  ticker: string;
  sleeveType: WealthUltraSleeve;
  riskTier: WealthUltraRiskTier;
  strategyMode: WealthUltraStrategyMode;
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
}

export type WealthUltraAlertType =
  | 'sleeve_overweight'
  | 'spec_breach'
  | 'max_per_ticker_breach'
  | 'over_budget'
  | 'position_trim_suggest'   // > +40%
  | 'position_risk_review';   // < -30%

export interface WealthUltraAlert {
  type: WealthUltraAlertType;
  message: string;
  ticker?: string;
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