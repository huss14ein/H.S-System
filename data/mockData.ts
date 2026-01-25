
import { FinancialData, Goal, InvestmentPortfolio, Account, Asset, Liability, InvestmentTransaction, Budget, WatchlistItem, Transaction } from '../types';

// This function generates a rich, multi-year dataset based on the user's rules.
const generateRealisticData = (): FinancialData => {
  let accounts: Account[] = [
    { id: 'acc1', name: 'Al Rajhi - Checking', type: 'Checking', balance: 75000 },
    { id: 'acc2', name: 'SNB - Savings', type: 'Savings', balance: 250000 },
    { id: 'acc3', name: 'Al Rajhi Capital', type: 'Investment', balance: 152150, platformDetails: { features: ['Tadawul & Global Trading', 'Sharia-compliant Funds', 'Sukuk Access', '24/7 Support'], assetTypes: ['Stocks', 'ETFs', 'Mutual Funds', 'Sukuk'], fees: 'SAR 0 commission on Tadawul trades.' }},
    { id: 'acc4', name: 'SABB Credit Card', type: 'Credit', balance: -5000 },
    { id: 'acc5', name: 'Riyad Capital (Robo)', type: 'Investment', balance: 52500, platformDetails: { features: ['Automated Robo-Advisor', 'Fractional Shares', 'Goal-based Investing', 'Simple UI'], assetTypes: ['ETFs', 'Mutual Funds', 'REITs'], fees: '0.25% annual advisory fee. No trading commissions.' }},
  ];
  let assets: Asset[] = [
    { id: 'asset1', name: 'Riyadh Villa', type: 'Property', value: 1500000, purchasePrice: 1200000, goalId: 'goal1' },
    { id: 'asset2', name: 'Family SUV', type: 'Vehicle', value: 100000, purchasePrice: 150000 },
    { id: 'asset3', name: 'Jeddah Apartment', type: 'Property', value: 750000, purchasePrice: 650000, goalId: 'goal3', isRental: true, monthlyRent: 5000 },
    { id: 'asset4', name: 'Gold Bullion', type: 'Gold and precious metals', value: 50000 },
  ];
  let liabilities: Liability[] = [
    { id: 'liab1', name: 'Home Mortgage', type: 'Mortgage', amount: -900000 },
    { id: 'liab2', name: 'Car Loan (Murabaha)', type: 'Loan', amount: -45000 },
  ];
  let goals: Goal[] = [
    { id: 'goal1', name: 'House Purchase', targetAmount: 800000, currentAmount: 650000, deadline: '2025-12-31', savingsAllocationPercent: 60 },
    { id: 'goal2', name: 'New Car', targetAmount: 150000, currentAmount: 75000, deadline: '2026-06-30', savingsAllocationPercent: 30 },
    { id: 'goal3', name: 'World Trip', targetAmount: 100000, currentAmount: 25000, deadline: '2027-01-01', savingsAllocationPercent: 10 },
  ];
  let investments: InvestmentPortfolio[] = [
    { id: 'port1', name: 'Tadawul Portfolio', accountId: 'acc3', owner: 'John Doe', holdings: [ { symbol: '2222.SR', name: 'Saudi Aramco', quantity: 100, avgCost: 35, currentValue: 3600, assetClass: 'Stock', zakahClass: 'Zakatable', realizedPnL: 1200 }, { symbol: '1120.SR', name: 'Al Rajhi Bank', quantity: 50, avgCost: 80, currentValue: 4500, assetClass: 'Stock', zakahClass: 'Zakatable', realizedPnL: -300 }, { symbol: 'SABIC.SUK', name: 'SABIC Sukuk 2028', quantity: 80, avgCost: 100, currentValue: 8100, assetClass: 'Sukuk', zakahClass: 'Zakatable', realizedPnL: 2500 }, { symbol: 'ETF.SA', name: 'Falcom Saudi Equity ETF', quantity: 200, avgCost: 450, currentValue: 108000, assetClass: 'ETF', zakahClass: 'Non-Zakatable', realizedPnL: 5000 } ] },
    { id: 'port2', name: 'Global Investments', accountId: 'acc5', owner: 'Family Trust', holdings: [ { symbol: 'JAREIT.SR', name: 'Jadwa REIT Saudi', quantity: 150, avgCost: 9, currentValue: 1500, assetClass: 'REIT', zakahClass: 'Non-Zakatable', realizedPnL: 4500 }, { symbol: 'BTC', name: 'Bitcoin', quantity: 0.05, avgCost: 200000, currentValue: 12500, assetClass: 'Cryptocurrency', zakahClass: 'Zakatable', realizedPnL: 200 }, { symbol: 'VTI', name: 'Vanguard Total Stock Market ETF', quantity: 120, avgCost: 200, currentValue: 38500, goalId: 'goal2', assetClass: 'ETF', zakahClass: 'Non-Zakatable', realizedPnL: 600 } ] },
  ];
  let investmentTransactions: InvestmentTransaction[] = [
    { id: 'itxn1', accountId: 'acc3', date: '2022-01-15', type: 'buy', symbol: 'ETF.SA', quantity: 100, price: 400, total: 40000 },
    { id: 'itxn2', accountId: 'acc3', date: '2022-05-20', type: 'buy', symbol: '2222.SR', quantity: 100, price: 35, total: 3500 },
  ];
  let budgets: Budget[] = [
    { category: 'Housing', limit: 3500 },
    { category: 'Transportation', limit: 1200 },
    { category: 'Food and Groceries', limit: 2500 },
    { category: 'Healthcare', limit: 800 },
    { category: 'Work and Residency-Related Expenses', limit: 500 },
    { category: 'Education', limit: 5000 },
    { category: 'Personal Care', limit: 500 },
    { category: 'Clothing', limit: 800 },
    { category: 'Entertainment and Leisure', limit: 1000 },
    { category: 'Travel and Vacation', limit: 1500 },
    { category: 'Communication', limit: 400 },
    { category: 'Savings and Investments', limit: 7500 },
    { category: 'Charity and Religious Contributions', limit: 500 },
    { category: 'Household and Miscellaneous', limit: 700 },
  ];
  let watchlist: WatchlistItem[] = [
      { symbol: 'MSFT', name: 'Microsoft Corp.' }, { symbol: 'NVDA', name: 'NVIDIA Corporation' }, { symbol: 'ACWA.SR', name: 'ACWA Power' },
  ];
  let transactions: Transaction[] = [];

  const startDate = new Date('2024-08-01');
  const endDate = new Date();
  let currentDate = new Date(startDate);
  let txnIdCounter = 100;

  while (currentDate <= endDate) {
    const month = currentDate.getMonth();
    const day = currentDate.getDate();

    if (day === 1) {
        transactions.push({ id: `txn${txnIdCounter++}`, accountId: 'acc1', date: currentDate.toISOString().split('T')[0], description: 'Salary', amount: 30000, category: 'Salary', budgetCategory: 'Income', type: 'income', transactionNature: 'Fixed' });
        if (month === 0) transactions.push({ id: `txn${txnIdCounter++}`, accountId: 'acc1', date: currentDate.toISOString().split('T')[0], description: 'Tickets Allowance', amount: 12000, category: 'Allowance', budgetCategory: 'Income', type: 'income', transactionNature: 'Variable' });
        if (month === 3) transactions.push({ id: `txn${txnIdCounter++}`, accountId: 'acc1', date: currentDate.toISOString().split('T')[0], description: 'Annual Bonus', amount: 90000, category: 'Bonus', budgetCategory: 'Income', type: 'income', transactionNature: 'Variable' });
        if (month % 2 === 0) transactions.push({ id: `txn${txnIdCounter++}`, accountId: 'acc1', date: currentDate.toISOString().split('T')[0], description: 'Rental Income - Jeddah Apt', amount: 5000, category: 'Rental Income', budgetCategory: 'Income', type: 'income', transactionNature: 'Fixed' });
    }
    if (day === 2) {
        if (month === 0 || month === 6) transactions.push({ id: `txn${txnIdCounter++}`, accountId: 'acc1', date: currentDate.toISOString().split('T')[0], description: 'Rent (Biannual)', amount: -18000, category: 'Rent', budgetCategory: 'Housing', type: 'expense', transactionNature: 'Fixed', expenseType: 'Core' });
        if (month === 5) transactions.push({ id: `txn${txnIdCounter++}`, accountId: 'acc1', date: currentDate.toISOString().split('T')[0], description: 'Dependents Fees', amount: -2000, category: 'Iqama Fees', budgetCategory: 'Work and Residency-Related Expenses', type: 'expense', transactionNature: 'Fixed', expenseType: 'Core' });
        if (month === 5 || month === 10) transactions.push({ id: `txn${txnIdCounter++}`, accountId: 'acc4', date: currentDate.toISOString().split('T')[0], description: 'Vacation Trip', amount: -8000, category: 'Travel', budgetCategory: 'Travel and Vacation', type: 'expense', transactionNature: 'Variable', expenseType: 'Discretionary' });
        if (month === 7) transactions.push({ id: `txn${txnIdCounter++}`, accountId: 'acc1', date: currentDate.toISOString().split('T')[0], description: 'Tuition Fees', amount: -5500, category: 'School Fees', budgetCategory: 'Education', type: 'expense', transactionNature: 'Fixed', expenseType: 'Core' });
        transactions.push({ id: `txn${txnIdCounter++}`, accountId: 'acc1', date: currentDate.toISOString().split('T')[0], description: 'STC Bill', amount: -(250 + Math.random() * 50), category: 'Internet Bill', budgetCategory: 'Communication', type: 'expense', transactionNature: 'Fixed', expenseType: 'Core' });
        transactions.push({ id: `txn${txnIdCounter++}`, accountId: 'acc2', date: currentDate.toISOString().split('T')[0], description: 'Investment Contribution', amount: -5000, category: 'Brokerage Deposit', budgetCategory: 'Savings and Investments', type: 'expense', transactionNature: 'Fixed', expenseType: 'Core' });
    }
    if ([5, 12, 19, 26].includes(day)) {
        transactions.push({ id: `txn${txnIdCounter++}`, accountId: 'acc1', date: currentDate.toISOString().split('T')[0], description: 'Lulu Groceries', amount: -(500 + Math.random() * 100), category: 'Groceries', subcategory: 'Lulu', budgetCategory: 'Food and Groceries', type: 'expense', transactionNature: 'Variable', expenseType: 'Core' });
        transactions.push({ id: `txn${txnIdCounter++}`, accountId: 'acc1', date: currentDate.toISOString().split('T')[0], description: 'Gasoline', amount: -(150 + Math.random() * 50), category: 'Fuel', budgetCategory: 'Transportation', type: 'expense', transactionNature: 'Variable', expenseType: 'Core' });
    }
    if ([10, 24].includes(day)) {
       transactions.push({ id: `txn${txnIdCounter++}`, accountId: 'acc4', date: currentDate.toISOString().split('T')[0], description: 'Dinner Out', amount: -(250 + Math.random() * 100), category: 'Restaurants', subcategory: 'Cheesecake Factory', budgetCategory: 'Food and Groceries', type: 'expense', transactionNature: 'Variable', expenseType: 'Discretionary' });
    }
    
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  transactions.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const settings = { riskProfile: 'Moderate' as const, budgetThreshold: 90, driftThreshold: 5, enableEmails: true, };

  return { accounts, assets, liabilities, goals, transactions, investments, investmentTransactions, budgets, watchlist, settings, zakatPayments: [], priceAlerts: [] };
};

export const mockFinancialData: FinancialData = generateRealisticData();
