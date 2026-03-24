/**
 * Plain-language copy for non-financial users.
 * Use these strings instead of jargon in UI, hints, and empty states.
 */

/** Short "What this is" for common terms */
export const TERM_EXPLANATIONS: Record<string, string> = {
  account: 'Where your money lives—like a bank account or investment platform.',
  balance: 'How much money is in an account right now.',
  budget: 'A spending limit you set for a category (e.g. groceries, dining).',
  category: 'A label for what you spent on (e.g. Food, Transport).',
  drift: 'How far your investments have shifted from your target mix. A small drift is normal; a big one may mean it\'s time to rebalance.',
  goal: 'Something you\'re saving for—a house, car, emergency fund, etc.',
  plannedTrade: 'A buy or sell you schedule in advance—it triggers when a target price or date is reached.',
  trigger: 'The condition that makes a plan ready to execute (e.g. price drops to X, or a specific date).',
  alignment: 'Whether your plan matches AI recommendations. Aligned = same direction; Conflict = opposite.',
  liability: 'Money you owe—loans, credit cards, mortgages.',
  netWorth: 'What you own minus what you owe. A simple snapshot of your financial position.',
  nisab: 'The minimum amount of wealth you must have before Zakat is due. Often calculated from gold price × 85 grams.',
  portfolio: 'Your collection of investments (stocks, funds, etc.) in one account.',
  rebalance: 'Adjusting your investments to match your target mix (e.g. 70% stable, 30% growth).',
  transaction: 'A single money movement—income, expense, or transfer.',
  transfer: 'Moving money from one account to another (e.g. from checking to savings).',
  zakat: 'Charitable giving (2.5%) on wealth above the Nisab threshold, for those who qualify.',
};

/** Page intro banners—what the user will do on this page */
export const PAGE_INTROS: Record<string, { title: string; description: string }> = {
  Dashboard: {
    title: 'Your financial overview',
    description: 'See your net worth, accounts, emergency fund, and what to do next. Everything updates from your data.',
  },
  Accounts: {
    title: 'Your money accounts',
    description: 'Add your bank accounts, savings, and investment platforms. Track balances and see where your money lives.',
  },
  Transactions: {
    title: 'Your financial activity',
    description: 'Record income and expenses. Categorize spending to see where it goes and stay within your budgets.',
  },
  Goals: {
    title: 'What you\'re saving for',
    description: 'Set goals (house, car, emergency fund) and track progress. The app suggests how to split your savings.',
  },
  Budgets: {
    title: 'Spending limits',
    description: 'Set monthly limits for categories. Get alerts when you\'re close to the limit so you can adjust.',
  },
  Liabilities: {
    title: 'What you owe',
    description: 'Track loans, credit cards, and other debts. See repayment progress and stress levels.',
  },
  Investments: {
    title: 'Your investments',
    description: 'Track your portfolios, holdings, and trades. See performance and get rebalancing suggestions.',
  },
  'Investment Plan': {
    title: 'Plan your trades ahead of time',
    description: 'You choose the stock and the rule (price or date). We watch the market for you and say when it’s time to act—then you confirm the trade in your portfolio.',
  },
  Settings: {
    title: 'Your preferences',
    description: 'Personalize risk level, alerts, and data. Export backups. No finance degree needed—we explain each option.',
  },
  Zakat: {
    title: 'Zakat calculation',
    description: 'See your zakatable wealth and estimated Zakat due. Set gold price or Nisab for accurate calculation.',
  },
};

/** Getting-started steps for new users */
export const GETTING_STARTED_STEPS: { label: string; action: string; page: 'Accounts' | 'Transactions' | 'Budgets' | 'Goals' }[] = [
  { label: 'Add your first account', action: 'Add bank or savings account', page: 'Accounts' },
  { label: 'Record a transaction', action: 'Log income or expense', page: 'Transactions' },
  { label: 'Set a budget', action: 'Add spending limit for a category', page: 'Budgets' },
  { label: 'Create a goal', action: 'Set savings target (e.g. emergency fund)', page: 'Goals' },
];

/** Friendly empty-state messages */
export const EMPTY_STATE_MESSAGES: Record<string, { title: string; description: string; action?: string }> = {
  noAccounts: {
    title: 'No accounts yet',
    description: 'Add your bank accounts, savings, or investment platforms to see your balances and net worth.',
    action: 'Add your first account',
  },
  noTransactions: {
    title: 'No transactions yet',
    description: 'Record income and expenses to track spending and see cash flow.',
    action: 'Add a transaction',
  },
  noGoals: {
    title: 'No goals yet',
    description: 'Set goals (house, car, emergency fund) to track progress and get savings suggestions.',
    action: 'Create a goal',
  },
  noBudgets: {
    title: 'No budgets yet',
    description: 'Set spending limits for categories to get alerts when you\'re close to the limit.',
    action: 'Add a budget',
  },
  noInvestments: {
    title: 'No investments yet',
    description: 'Add your investment platforms and portfolios to track holdings and performance.',
    action: 'Add a portfolio',
  },
  noPlannedTrades: {
    title: 'No trade plans yet',
    description: 'Tell the app what you’d like to buy or sell and when (price or date). When the market hits your rule, we’ll flag it so you can record the trade—no need to watch charts all day.',
    action: 'Create your first plan',
  },
  noAiCandidates: {
    title: 'All set for now',
    description: 'Your plans already cover the symbols AI recommends. Add more from your universe when you\'re ready.',
  },
};

/** Session storage key for passing plan data when navigating to Record Trade from Investment Plan */
export const EXECUTE_PLAN_STORAGE_KEY = 'investmentPlan_executePlan';
