





export type Page = 'Dashboard' | 'Summary' | 'Accounts' | 'Goals' | 'Investments' | 'Assets' | 'Liabilities' | 'Transactions' | 'Budgets' | 'Plan' | 'Analysis' | 'Forecast' | 'Zakat' | 'Notifications' | 'System & APIs Health' | 'Settings';

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
  type: 'buy' | 'sell' | 'dividend';
  symbol: string;
  quantity: number;
  price: number;
  total: number;
}

export interface Budget {
  id: string;
  user_id?: string;
  category: string;
  limit: number;
  month: number; // 1-12
  year: number;
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

export interface FinancialData {
  accounts: Account[];
  assets: Asset[];
  liabilities: Liability[];
  goals: Goal[];
  transactions: Transaction[];
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
  brokerConstraints: BrokerConstraints;
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