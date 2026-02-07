import { FinancialData } from '../types';

// Note: IDs are for relational mapping during the seeding process only. They are not the final DB IDs.
export const getMockData = (): Omit<FinancialData, 'settings' | 'zakatPayments' | 'priceAlerts'> => {
  const today = new Date();
  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
  const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 15).toISOString().split('T')[0];
  const twoMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 2, 10).toISOString().split('T')[0];
  const threeMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 3, 5).toISOString().split('T')[0];
  
  // Helper to give a slight variation to current value for realism
  const withVariation = (value: number) => value * (0.95 + Math.random() * 0.1); // +/- 5% variation

  return {
    accounts: [
        { id: 'acc1', name: 'Al Rajhi (Current)', type: 'Checking', balance: 25430.50 },
        { id: 'acc2', name: 'SNB (Savings)', type: 'Savings', balance: 152000 },
        { id: 'acc3', name: 'SABB Credit Card', type: 'Credit', balance: -4580.75 },
        { id: 'acc4', name: 'Derayah Financial', type: 'Investment', balance: 0 },
        { id: 'acc5', name: 'SNB Capital', type: 'Investment', balance: 0 },
    ],
    assets: [
        { id: 'asset1', name: 'Primary Residence', type: 'Property', value: 2500000, purchasePrice: 1800000 },
        { id: 'asset2', name: 'Rental Apartment', type: 'Property', value: 850000, purchasePrice: 700000, isRental: true, monthlyRent: 4000 },
        { id: 'asset3', name: 'Toyota Camry 2023', type: 'Vehicle', value: 110000, purchasePrice: 135000 },
        { id: 'asset4', name: 'Gold Bullion (100g)', type: 'Gold and precious metals', value: 27500, purchasePrice: 22000 },
    ],
    liabilities: [
        { id: 'liab1', name: 'Home Mortgage', type: 'Mortgage', amount: -1250000, status: 'Active' },
        { id: 'liab2', name: 'Car Loan', type: 'Loan', amount: -65000, status: 'Active' },
    ],
    goals: [
        { id: 'goal1', name: 'World Trip', targetAmount: 75000, currentAmount: 0, deadline: new Date(new Date().getFullYear() + 2, 5, 1).toISOString(), savingsAllocationPercent: 30 },
        { id: 'goal2', name: 'Rental Property Downpayment', targetAmount: 300000, currentAmount: 0, deadline: new Date(new Date().getFullYear() + 3, 11, 1).toISOString(), savingsAllocationPercent: 70 },
    ],
    transactions: [
        { id: 't1', date: firstDayOfMonth, description: 'Monthly Salary', amount: 30000, category: 'Salary', accountId: 'acc1', type: 'income' },
        { id: 't2', date: new Date(new Date().setDate(2)).toISOString().split('T')[0], description: 'Hyper Panda Groceries', amount: -1250.75, category: 'Groceries', budgetCategory: 'Food', accountId: 'acc3', type: 'expense', transactionNature: 'Variable', expenseType: 'Core' },
        { id: 't3', date: new Date(new Date().setDate(3)).toISOString().split('T')[0], description: 'Mortgage Payment', amount: -7500, category: 'Mortgage', budgetCategory: 'Housing', accountId: 'acc1', type: 'expense', transactionNature: 'Fixed', expenseType: 'Core' },
        { id: 't4', date: new Date(new Date().setDate(5)).toISOString().split('T')[0], description: 'Jarir Bookstore', amount: -350, category: 'Shopping', budgetCategory: 'Shopping', accountId: 'acc3', type: 'expense', transactionNature: 'Variable', expenseType: 'Discretionary' },
        { id: 't5', date: lastMonth, description: 'STC Bill', amount: -450, category: 'Utilities', budgetCategory: 'Utilities', accountId: 'acc3', type: 'expense', transactionNature: 'Fixed', expenseType: 'Core' },
        { id: 't6', date: lastMonth, description: 'Investment Transfer', amount: -5000, category: 'Transfers', budgetCategory: 'Savings & Investments', accountId: 'acc1', type: 'expense' },
        { id: 't7', date: twoMonthsAgo, description: 'Monthly Salary', amount: 30000, category: 'Salary', accountId: 'acc1', type: 'income' },
        { id: 't8', date: twoMonthsAgo, description: 'Car Loan Payment', amount: -1800, category: 'Car Loan', budgetCategory: 'Transportation', accountId: 'acc1', type: 'expense', transactionNature: 'Fixed', expenseType: 'Core' },
    ],
    investments: [
      {
        id: 'p1',
        name: 'Tadawul Portfolio',
        accountId: 'acc4',
        holdings: [
          { id: 'h1', symbol: '2222.SR', name: 'Saudi Aramco', quantity: 100, avgCost: 35.50, currentValue: withVariation(35.50 * 100), zakahClass: 'Zakatable', realizedPnL: 0, assetClass: 'Stock' },
          { id: 'h2', symbol: '1120.SR', name: 'Al Rajhi Bank', quantity: 50, avgCost: 80.20, currentValue: withVariation(80.20 * 50), zakahClass: 'Zakatable', realizedPnL: 0, assetClass: 'Stock' },
          { id: 'h3', symbol: 'REITF.SR', name: 'AlJazira REIT', quantity: 200, avgCost: 18.00, currentValue: withVariation(18.00 * 200), zakahClass: 'Zakatable', realizedPnL: 0, assetClass: 'REIT' },
        ]
      },
      {
        id: 'p2',
        name: 'International Stocks',
        accountId: 'acc5',
        holdings: [
          { id: 'h4', symbol: 'MSFT', name: 'Microsoft Corp', quantity: 10, avgCost: 300.00, currentValue: withVariation(300.00 * 10), zakahClass: 'Zakatable', realizedPnL: 150, assetClass: 'Stock' },
          { id: 'h5', symbol: 'VOO', name: 'Vanguard S&P 500 ETF', quantity: 5, avgCost: 400.00, currentValue: withVariation(400.00 * 5), zakahClass: 'Zakatable', realizedPnL: 0, assetClass: 'ETF' },
        ]
      },
      {
        id: 'p3',
        name: 'US Growth Portfolio',
        accountId: 'acc4',
        holdings: [
          { id: 'h6', symbol: 'NVDA', name: 'NVIDIA Corp', quantity: 5, avgCost: 120.00, currentValue: withVariation(120.00 * 5), zakahClass: 'Zakatable', realizedPnL: 0, assetClass: 'Stock' },
          { id: 'h7', symbol: 'TSLA', name: 'Tesla, Inc.', quantity: 10, avgCost: 180.00, currentValue: withVariation(180.00 * 10), zakahClass: 'Zakatable', realizedPnL: 0, assetClass: 'Stock' },
        ]
      }
    ],
    investmentTransactions: [
        { id: 'it1', accountId: 'acc4', date: lastMonth, type: 'buy', symbol: '2222.SR', quantity: 100, price: 35.50, total: 3550 },
        { id: 'it2', accountId: 'acc5', date: lastMonth, type: 'buy', symbol: 'MSFT', quantity: 10, price: 300.00, total: 3000 },
        { id: 'it3', accountId: 'acc4', date: twoMonthsAgo, type: 'buy', symbol: '1120.SR', quantity: 50, price: 80.20, total: 4010 },
        { id: 'it4', accountId: 'acc4', date: threeMonthsAgo, type: 'buy', symbol: 'NVDA', quantity: 5, price: 120.00, total: 600 },
        { id: 'it5', accountId: 'acc4', date: threeMonthsAgo, type: 'buy', symbol: 'TSLA', quantity: 10, price: 180.00, total: 1800 },
    ],
    budgets: [
        { id: 'b1', category: 'Food', limit: 3000, month: today.getMonth() + 1, year: today.getFullYear() },
        { id: 'b2', category: 'Housing', limit: 8000, month: today.getMonth() + 1, year: today.getFullYear() },
        { id: 'b3', category: 'Transportation', limit: 1500, month: today.getMonth() + 1, year: today.getFullYear() },
        { id: 'b4', category: 'Utilities', limit: 1000, month: today.getMonth() + 1, year: today.getFullYear() },
        { id: 'b5', category: 'Shopping', limit: 2000, month: today.getMonth() + 1, year: today.getFullYear() },
        { id: 'b6', category: 'Entertainment', limit: 1000, month: today.getMonth() + 1, year: today.getFullYear() },
        { id: 'b7', category: 'Savings & Investments', limit: 5000, month: today.getMonth() + 1, year: today.getFullYear() },
    ],
    commodityHoldings: [
      { id: 'ch1', name: 'Gold', quantity: 100, unit: 'gram', purchaseValue: 22000, currentValue: withVariation(27500), symbol: 'XAU_GRAM' },
      { id: 'ch2', name: 'Bitcoin', quantity: 0.05, unit: 'BTC', purchaseValue: 12000, currentValue: withVariation(13000), symbol: 'BTC_USD' }
    ],
    watchlist: [
        { symbol: '7010.SR', name: 'STC' },
        { symbol: 'AAPL', name: 'Apple Inc.' },
    ],
    plannedTrades: [
      {
        id: 'pt1',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        tradeType: 'buy',
        conditionType: 'price',
        targetValue: 180, // Price target
        amount: 5000,
        priority: 'Medium',
        status: 'Planned',
        notes: 'Buy on dip before next product launch.'
      },
      {
        id: 'pt2',
        symbol: '2222.SR',
        name: 'Saudi Aramco',
        tradeType: 'sell',
        conditionType: 'date',
        targetValue: new Date(new Date().getFullYear(), new Date().getMonth() + 3, 1).getTime(), // Date target
        quantity: 50,
        priority: 'High',
        status: 'Planned',
        notes: 'Re-evaluate position in 3 months.'
      }
    ],
  };
};