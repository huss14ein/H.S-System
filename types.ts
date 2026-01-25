
export type Page = 'Dashboard' | 'Summary' | 'Platform' | 'Goals' | 'Investments' | 'Assets' | 'Liabilities' | 'Transactions' | 'Budgets' | 'Plan' | 'Analysis' | 'Forecast' | 'Zakat' | 'System & APIs Health';

export interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  deadline: string;
  savingsAllocationPercent?: number;
}

export interface Account {
  id:string;
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
  name: string;
  type: 'Mortgage' | 'Loan' | 'Credit Card' | 'Personal Loan';
  amount: number;
}

export interface Transaction {
  id: string;
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
  id?: string; // Added ID for database operations
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
  name: string;
  accountId: string;
  holdings: Holding[];
  owner?: string;
}

export interface InvestmentTransaction {
  id: string;
  accountId: string;
  date: string;
  type: 'buy' | 'sell';
  symbol: string;
  quantity: number;
  price: number;
  total: number;
}

export interface Budget {
  category: string;
  limit: number;
}

export interface WatchlistItem {
    symbol: string;
    name: string;
}

export type RiskProfile = 'Conservative' | 'Moderate' | 'Aggressive';

export interface Settings {
    riskProfile: RiskProfile;
    budgetThreshold: number; // e.g., 90%
    driftThreshold: number; // e.g., 5%
    enableEmails: boolean;
}

export interface ZakatPayment {
    id: string;
    date: string;
    amount: number;
    notes?: string;
}

export interface PriceAlert {
  id: string;
  symbol: string;
  targetPrice: number;
  status: 'active' | 'triggered';
  createdAt: string;
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
  watchlist: WatchlistItem[];
  settings: Settings;
  zakatPayments: ZakatPayment[];
  priceAlerts: PriceAlert[];
  simulatedPrices: Record<string, { price: number; change: number; changePercent: number }>;
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