


export type Page = 'Dashboard' | 'Summary' | 'Accounts' | 'Goals' | 'Investments' | 'Assets' | 'Liabilities' | 'Transactions' | 'Budgets' | 'Plan' | 'Analysis' | 'Forecast' | 'Zakat' | 'Commodities' | 'Notifications' | 'System & APIs Health';

export interface Goal {
  id: string;
  user_id?: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  deadline: string;
  savingsAllocationPercent?: number;
}

export interface Account {
  id:string;
  user_id?: string;
  name: string;
  type: 'Checking' | 'Savings' | 'Investment' | 'Credit';
  balance: number;
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
  | 'Gold and precious metals'
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
}

export interface Liability {
  id: string;
  user_id?: string;
  name: string;
  type: 'Mortgage' | 'Loan' | 'Credit Card' | 'Personal Loan';
  amount: number;
  status?: 'Active' | 'Paid';
  goalId?: string;
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
}

export interface InvestmentPortfolio {
  id: string;
  user_id?: string;
  name: string;
  accountId: string;
  holdings: Holding[];
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