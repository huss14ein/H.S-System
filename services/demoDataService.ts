/**
 * Demo Data Service
 * Provides demo/sample data for testing and demonstration purposes across all pages
 */

export interface DemoDataOptions {
  includeWealthUltra?: boolean;
  includeRecoveryPlan?: boolean;
  includeMarketEvents?: boolean;
  includeBudgets?: boolean;
  includeInvestments?: boolean;
  includeTransactions?: boolean;
  includeAccounts?: boolean;
  includeGoals?: boolean;
  includeAssets?: boolean;
  includeLiabilities?: boolean;
  includeAll?: boolean;
}

/**
 * Generate demo performance snapshots for Wealth Ultra
 */
export function generateDemoPerformanceSnapshots(count: number = 30): Array<{
  timestamp: number;
  totalPortfolioValue: number;
  allocations: Array<{ sleeve: string; marketValue: number; driftPct: number }>;
  positions: Array<{ symbol: string; marketValue: number; plPct: number; sleeveType: string }>;
  metrics: { totalReturn: number; totalReturnPct: number };
}> {
  const snapshots = [];
  const baseValue = 100000;
  const symbols = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'NVDA', 'META', 'NFLX'];
  const sleeves = ['Core', 'Upside', 'Spec'];
  
  for (let i = 0; i < count; i++) {
    const daysAgo = count - i - 1;
    const timestamp = Date.now() - (daysAgo * 24 * 60 * 60 * 1000);
    
    // Simulate portfolio growth with some volatility
    const portfolioValue = baseValue * Math.pow(1.001, daysAgo) * (1 + (Math.random() - 0.5) * 0.02);
    
    const allocations = sleeves.map(sleeve => ({
      sleeve,
      marketValue: portfolioValue * (sleeve === 'Core' ? 0.65 : sleeve === 'Upside' ? 0.28 : 0.07),
      driftPct: (Math.random() - 0.5) * 4, // ±2% drift
    }));
    
    const positionsPerSleeve = Math.floor(symbols.length / sleeves.length);
    const positions = symbols.slice(0, 6).map((symbol, idx) => {
      const sleeveIdx = Math.floor(idx / positionsPerSleeve);
      const plPct = (Math.random() - 0.5) * 40; // -20% to +20%
      return {
        symbol,
        marketValue: portfolioValue * (0.1 + Math.random() * 0.1),
        plPct,
        sleeveType: sleeves[sleeveIdx] || 'Core',
      };
    });
    
    snapshots.push({
      timestamp,
      totalPortfolioValue: portfolioValue,
      allocations,
      positions,
      metrics: {
        totalReturn: portfolioValue - baseValue,
        totalReturnPct: ((portfolioValue - baseValue) / baseValue) * 100,
      },
    });
  }
  
  return snapshots;
}

/**
 * Generate demo recovery plan executions
 */
export function generateDemoRecoveryExecutions(): Array<{
  id: string;
  symbol: string;
  timestamp: number;
  initialPlPct: number;
  initialPrice: number;
  initialShares: number;
  initialAvgCost: number;
  recoveryConfig: {
    lossTriggerPct: number;
    cashCap: number;
    ladderLevels: number;
    totalPlannedCost: number;
  };
  executionStatus: 'planned' | 'partial' | 'complete' | 'cancelled';
  currentState?: {
    shares: number;
    avgCost: number;
    currentPrice: number;
    plPct: number;
    recoveryProgress: number;
  };
  outcome?: {
    recovered: boolean;
    recoveryTimeDays?: number;
    finalPlPct: number;
    roi: number;
  };
}> {
  const symbols = ['AAPL', 'MSFT', 'GOOGL', 'TSLA', 'NVDA'];
  const executions: Array<{
    id: string;
    symbol: string;
    timestamp: number;
    initialPlPct: number;
    initialPrice: number;
    initialShares: number;
    initialAvgCost: number;
    recoveryConfig: {
      lossTriggerPct: number;
      cashCap: number;
      ladderLevels: number;
      totalPlannedCost: number;
    };
    executionStatus: 'planned' | 'partial' | 'complete' | 'cancelled';
    currentState?: {
      shares: number;
      avgCost: number;
      currentPrice: number;
      plPct: number;
      recoveryProgress: number;
    };
    outcome?: {
      recovered: boolean;
      recoveryTimeDays?: number;
      finalPlPct: number;
      roi: number;
    };
  }> = [];
  
  symbols.forEach((symbol, idx) => {
    const daysAgo = (symbols.length - idx) * 15;
    const timestamp = Date.now() - (daysAgo * 24 * 60 * 60 * 1000);
    const initialPlPct = -15 - Math.random() * 10; // -15% to -25%
    const initialPrice = 100 + Math.random() * 50;
    const initialShares = 100;
    const initialAvgCost = initialPrice * 1.2;
    
    const recovered = idx < 3; // First 3 are recovered
    const recoveryTimeDays = recovered ? 20 + Math.random() * 40 : undefined;
    const finalPlPct = recovered ? -2 + Math.random() * 5 : initialPlPct + Math.random() * 5;
    
    executions.push({
      id: `demo-recovery-${symbol}-${timestamp}`,
      symbol,
      timestamp,
      initialPlPct,
      initialPrice,
      initialShares,
      initialAvgCost,
      recoveryConfig: {
        lossTriggerPct: 15 + Math.random() * 5,
        cashCap: 5000 + Math.random() * 5000,
        ladderLevels: 2 + Math.floor(Math.random() * 2),
        totalPlannedCost: 3000 + Math.random() * 4000,
      },
      executionStatus: recovered ? 'complete' : idx === 3 ? 'partial' : 'planned',
      currentState: {
        shares: initialShares + (recovered ? 50 : 20),
        avgCost: initialAvgCost * (recovered ? 0.95 : 0.98),
        currentPrice: initialPrice * (1 + (finalPlPct / 100)),
        plPct: finalPlPct,
        recoveryProgress: recovered ? 100 : 30 + Math.random() * 40,
      },
      outcome: recovered ? {
        recovered: true,
        recoveryTimeDays,
        finalPlPct,
        roi: 0.05 + Math.random() * 0.15,
      } : undefined,
    });
  });
  
  return executions;
}

/**
 * Generate demo market events
 */
export function generateDemoMarketEvents(): Array<{
  id: string;
  date: Date;
  title: string;
  description: string;
  source: string;
  category: 'Macro' | 'Earnings' | 'Dividend' | 'Portfolio';
  impact: 'High' | 'Medium' | 'Low';
  symbol?: string;
  estimated?: boolean;
  detailedInfo?: {
    meetingType?: string;
    historicalContext?: string;
    keyMetrics?: string[];
    relatedEvents?: string[];
    marketImpactHistory?: string;
    preparationTips?: string[];
  };
}> {
  const now = new Date();
  const events: Array<{
    id: string;
    date: Date;
    title: string;
    description: string;
    source: string;
    category: 'Macro' | 'Earnings' | 'Dividend' | 'Portfolio';
    impact: 'High' | 'Medium' | 'Low';
    symbol?: string;
    estimated?: boolean;
    detailedInfo?: {
      meetingType?: string;
      historicalContext?: string;
      keyMetrics?: string[];
      relatedEvents?: string[];
      marketImpactHistory?: string;
      preparationTips?: string[];
    };
  }> = [];
  
  // FOMC Meeting
  events.push({
    id: 'demo-fomc-1',
    date: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    title: 'FOMC Meeting - Interest Rate Decision',
    description: 'Federal Open Market Committee meeting to discuss monetary policy and interest rates.',
    source: 'Federal Reserve',
    category: 'Macro',
    impact: 'High',
    estimated: false,
    detailedInfo: {
      meetingType: 'Quarterly Meeting with SEP',
      historicalContext: 'The Fed has been monitoring inflation closely. Previous meetings have shown a pattern of gradual rate adjustments.',
      keyMetrics: ['Federal Funds Rate', 'Inflation Rate (CPI)', 'Unemployment Rate', 'GDP Growth'],
      relatedEvents: ['CPI Release', 'Employment Report'],
      marketImpactHistory: 'Historically, FOMC meetings have caused 1-3% market volatility. Rate hikes typically lead to short-term market declines.',
      preparationTips: [
        'Review portfolio allocation before meeting',
        'Consider reducing leverage',
        'Monitor bond yields',
        'Prepare for potential volatility',
      ],
    },
  });
  
  // Earnings events
  const earningsSymbols = ['AAPL', 'MSFT', 'GOOGL', 'AMZN'];
  earningsSymbols.forEach((symbol, idx) => {
    events.push({
      id: `demo-earnings-${symbol}`,
      date: new Date(now.getTime() + (idx + 1) * 14 * 24 * 60 * 60 * 1000),
      title: `${symbol} Q4 Earnings Release`,
      description: `${symbol} will report quarterly earnings results.`,
      source: 'Company Announcement',
      category: 'Earnings',
      impact: 'High',
      symbol,
      estimated: true,
    });
  });
  
  // Dividend events
  const dividendSymbols = ['AAPL', 'MSFT'];
  dividendSymbols.forEach((symbol, idx) => {
    events.push({
      id: `demo-dividend-${symbol}`,
      date: new Date(now.getTime() + (idx + 1) * 30 * 24 * 60 * 60 * 1000),
      title: `${symbol} Dividend Payment`,
      description: `${symbol} quarterly dividend payment date.`,
      source: 'Company Announcement',
      category: 'Dividend',
      impact: 'Low',
      symbol,
      estimated: true,
    });
  });
  
  return events;
}

/**
 * Generate demo budget months for Household Budget Engine
 */
export function generateDemoBudgetMonths(count: number = 12): Array<{
  month: number;
  incomePlanned: number;
  incomeActual: number;
  totalPlannedOutflow: number;
  totalActualOutflow: number;
  netPlanned: number;
  netActual: number;
}> {
  const months = [];
  const baseIncome = 5000;
  const baseExpense = 3500;
  
  for (let i = 1; i <= count; i++) {
    const incomeVariation = 1 + (Math.random() - 0.5) * 0.1; // ±5%
    const expenseVariation = 1 + (Math.random() - 0.5) * 0.15; // ±7.5%
    
    // Simulate some months with higher expenses (holidays, etc.)
    const seasonalBoost = (i === 11 || i === 12) ? 1.2 : 1; // Nov/Dec higher
    
    const incomePlanned = baseIncome;
    const incomeActual = baseIncome * incomeVariation;
    const totalPlannedOutflow = baseExpense * seasonalBoost;
    const totalActualOutflow = baseExpense * seasonalBoost * expenseVariation;
    
    months.push({
      month: i,
      incomePlanned,
      incomeActual,
      totalPlannedOutflow,
      totalActualOutflow,
      netPlanned: incomePlanned - totalPlannedOutflow,
      netActual: incomeActual - totalActualOutflow,
    });
  }
  
  return months;
}

/**
 * Generate demo transactions
 */
export function generateDemoTransactions(count: number = 50): Array<{
  id: string;
  date: string;
  description: string;
  amount: number;
  category: string;
  subcategory?: string;
  budgetCategory?: string;
  type: 'income' | 'expense';
  accountId?: string;
  transactionNature?: 'Fixed' | 'Variable';
  expenseType?: 'Core' | 'Discretionary';
}> {
  type DemoTransaction = {
    id: string;
    date: string;
    description: string;
    amount: number;
    category: string;
    subcategory?: string;
    budgetCategory?: string;
    type: 'income' | 'expense';
    accountId?: string;
    transactionNature?: 'Fixed' | 'Variable';
    expenseType?: 'Core' | 'Discretionary';
  };

  const transactions: DemoTransaction[] = [];
  const categories = ['Food', 'Transportation', 'Housing', 'Utilities', 'Health', 'Education', 'Entertainment', 'Shopping', 'Savings & Investments'];
  const descriptions = [
    'Grocery Store', 'Restaurant', 'Gas Station', 'Uber Ride', 'Rent Payment', 'Electric Bill', 'Internet Bill',
    'Doctor Visit', 'Pharmacy', 'Tuition Fee', 'Movie Ticket', 'Shopping Mall', 'Investment Deposit', 'Salary',
    'Freelance Work', 'Dividend Payment', 'Interest Income'
  ];
  
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const daysAgo = Math.floor(Math.random() * 90);
    const date = new Date(now - daysAgo * 24 * 60 * 60 * 1000);
    const isIncome = Math.random() > 0.85;
    const category = categories[Math.floor(Math.random() * categories.length)];
    const description = descriptions[Math.floor(Math.random() * descriptions.length)];
    const amount = isIncome 
      ? 1000 + Math.random() * 5000
      : -(50 + Math.random() * 500);
    
    transactions.push({
      id: `demo-tx-${i}-${date.getTime()}`,
      date: date.toISOString().split('T')[0],
      description,
      amount,
      category,
      subcategory: Math.random() > 0.7 ? 'Subcategory' : undefined,
      budgetCategory: Math.random() > 0.5 ? category : undefined,
      type: isIncome ? 'income' as const : 'expense' as const,
      accountId: `demo-account-${Math.floor(Math.random() * 3)}`,
      transactionNature: Math.random() > 0.6 ? 'Fixed' : 'Variable',
      expenseType: Math.random() > 0.5 ? 'Core' : 'Discretionary',
    });
  }
  
  return transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

/**
 * Generate demo accounts
 */
export function generateDemoAccounts(): Array<{
  id: string;
  name: string;
  type: string;
  balance: number;
  currency: string;
}> {
  return [
    { id: 'demo-checking-1', name: 'Primary Checking', type: 'Checking', balance: 5000 + Math.random() * 3000, currency: 'SAR' },
    { id: 'demo-savings-1', name: 'Emergency Savings', type: 'Savings', balance: 15000 + Math.random() * 10000, currency: 'SAR' },
    { id: 'demo-investment-1', name: 'Investment Account', type: 'Investment', balance: 50000 + Math.random() * 50000, currency: 'USD' },
    { id: 'demo-retirement-1', name: 'Retirement Plan', type: 'Retirement', balance: 100000 + Math.random() * 50000, currency: 'SAR' },
  ];
}

/**
 * Generate demo goals
 */
export function generateDemoGoals(): Array<{
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  targetDate: string;
  priority: 'High' | 'Medium' | 'Low';
  category: string;
}> {
  const now = new Date();
  return [
    {
      id: 'demo-goal-1',
      name: 'Emergency Fund',
      targetAmount: 50000,
      currentAmount: 25000 + Math.random() * 10000,
      targetDate: new Date(now.getFullYear() + 1, now.getMonth(), 1).toISOString().split('T')[0],
      priority: 'High',
      category: 'Savings',
    },
    {
      id: 'demo-goal-2',
      name: 'Vacation Fund',
      targetAmount: 10000,
      currentAmount: 3000 + Math.random() * 2000,
      targetDate: new Date(now.getFullYear(), now.getMonth() + 6, 1).toISOString().split('T')[0],
      priority: 'Medium',
      category: 'Travel',
    },
    {
      id: 'demo-goal-3',
      name: 'Home Down Payment',
      targetAmount: 200000,
      currentAmount: 50000 + Math.random() * 30000,
      targetDate: new Date(now.getFullYear() + 2, now.getMonth(), 1).toISOString().split('T')[0],
      priority: 'High',
      category: 'Housing',
    },
  ];
}

/**
 * Generate demo assets
 */
export function generateDemoAssets(): Array<{
  id: string;
  name: string;
  type: string;
  value: number;
  purchaseDate: string;
  category: string;
}> {
  const now = new Date();
  return [
    {
      id: 'demo-asset-1',
      name: 'Primary Residence',
      type: 'Real Estate',
      value: 500000 + Math.random() * 200000,
      purchaseDate: new Date(now.getFullYear() - 5, 0, 1).toISOString().split('T')[0],
      category: 'Property',
    },
    {
      id: 'demo-asset-2',
      name: 'Vehicle',
      type: 'Vehicle',
      value: 30000 + Math.random() * 20000,
      purchaseDate: new Date(now.getFullYear() - 2, 6, 1).toISOString().split('T')[0],
      category: 'Transportation',
    },
    {
      id: 'demo-asset-3',
      name: 'Investment Property',
      type: 'Real Estate',
      value: 300000 + Math.random() * 100000,
      purchaseDate: new Date(now.getFullYear() - 3, 3, 1).toISOString().split('T')[0],
      category: 'Property',
    },
  ];
}

/**
 * Generate demo liabilities
 */
export function generateDemoLiabilities(): Array<{
  id: string;
  name: string;
  type: string;
  balance: number;
  interestRate: number;
  minimumPayment: number;
  dueDate: string;
}> {
  const now = new Date();
  return [
    {
      id: 'demo-liability-1',
      name: 'Mortgage',
      type: 'Mortgage',
      balance: 300000 + Math.random() * 100000,
      interestRate: 3.5 + Math.random() * 1.5,
      minimumPayment: 1500 + Math.random() * 500,
      dueDate: new Date(now.getFullYear(), now.getMonth() + 1, 15).toISOString().split('T')[0],
    },
    {
      id: 'demo-liability-2',
      name: 'Credit Card',
      type: 'Credit Card',
      balance: 5000 + Math.random() * 3000,
      interestRate: 18 + Math.random() * 5,
      minimumPayment: 150 + Math.random() * 100,
      dueDate: new Date(now.getFullYear(), now.getMonth() + 1, 20).toISOString().split('T')[0],
    },
    {
      id: 'demo-liability-3',
      name: 'Car Loan',
      type: 'Loan',
      balance: 15000 + Math.random() * 10000,
      interestRate: 4.5 + Math.random() * 2,
      minimumPayment: 300 + Math.random() * 200,
      dueDate: new Date(now.getFullYear(), now.getMonth() + 1, 10).toISOString().split('T')[0],
    },
  ];
}

/**
 * Load demo data into localStorage for testing
 */
export function loadDemoData(options: DemoDataOptions = {}): void {
  if (typeof window === 'undefined') return;
  
  // If includeAll is true, set all flags to true
  if (options.includeAll) {
    options = {
      includeWealthUltra: true,
      includeRecoveryPlan: true,
      includeMarketEvents: true,
      includeBudgets: true,
      includeInvestments: true,
      includeTransactions: true,
      includeAccounts: true,
      includeGoals: true,
      includeAssets: true,
      includeLiabilities: true,
    };
  }
  
  try {
    // Wealth Ultra Performance Snapshots
    if (options.includeWealthUltra !== false) {
      const snapshots = generateDemoPerformanceSnapshots(30);
      window.localStorage.setItem('wealth-ultra-performance-snapshots:v1', JSON.stringify(snapshots));
    }
    
    // Recovery Plan Executions
    if (options.includeRecoveryPlan !== false) {
      const executions = generateDemoRecoveryExecutions();
      window.localStorage.setItem('recovery-plan-executions:v1', JSON.stringify(executions));
    }
    
    // Market Events
    if (options.includeMarketEvents !== false) {
      const events = generateDemoMarketEvents();
      window.localStorage.setItem('demo-market-events:v1', JSON.stringify(events.map(e => ({
        ...e,
        date: e.date.toISOString(),
      }))));
    }
    
    // Budget Months
    if (options.includeBudgets !== false) {
      const months = generateDemoBudgetMonths(12);
      window.localStorage.setItem('demo-budget-months:v1', JSON.stringify(months));
    }
    
    // Transactions
    if (options.includeTransactions !== false) {
      const transactions = generateDemoTransactions(50);
      window.localStorage.setItem('demo-transactions:v1', JSON.stringify(transactions));
    }
    
    // Accounts
    if (options.includeAccounts !== false) {
      const accounts = generateDemoAccounts();
      window.localStorage.setItem('demo-accounts:v1', JSON.stringify(accounts));
    }
    
    // Goals
    if (options.includeGoals !== false) {
      const goals = generateDemoGoals();
      window.localStorage.setItem('demo-goals:v1', JSON.stringify(goals));
    }
    
    // Assets
    if (options.includeAssets !== false) {
      const assets = generateDemoAssets();
      window.localStorage.setItem('demo-assets:v1', JSON.stringify(assets));
    }
    
    // Liabilities
    if (options.includeLiabilities !== false) {
      const liabilities = generateDemoLiabilities();
      window.localStorage.setItem('demo-liabilities:v1', JSON.stringify(liabilities));
    }
  } catch {
    // Ignore demo data errors in production builds
  }
}

/**
 * Clear demo data from localStorage
 */
export function clearDemoData(): void {
  if (typeof window === 'undefined') return;
  
  try {
    window.localStorage.removeItem('wealth-ultra-performance-snapshots:v1');
    window.localStorage.removeItem('recovery-plan-executions:v1');
    window.localStorage.removeItem('demo-market-events:v1');
    window.localStorage.removeItem('demo-budget-months:v1');
    window.localStorage.removeItem('demo-transactions:v1');
    window.localStorage.removeItem('demo-accounts:v1');
    window.localStorage.removeItem('demo-goals:v1');
    window.localStorage.removeItem('demo-assets:v1');
    window.localStorage.removeItem('demo-liabilities:v1');
  } catch {
    // Ignore demo clear errors in production builds
  }
}
