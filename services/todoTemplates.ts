import type { Page, TodoPriority, TodoRecurrence } from '../types';

export type TodoTemplate = {
  id: string;
  title: string;
  priority: TodoPriority;
  tags?: string[];
  recurrence?: TodoRecurrence;
  listId?: string;
  /** Optional convenience: pre-fill which page this task should link to. */
  linkedPage?: Page;
};

export const TODO_TEMPLATES: TodoTemplate[] = [
  // --- Core recurring finance hygiene ---
  {
    id: 'review-budget',
    title: 'Review monthly budget vs actuals',
    priority: 'high',
    tags: ['budgets', 'variance', 'spend'],
    recurrence: 'monthly',
    listId: 'Budgets',
    linkedPage: 'Budgets',
  },
  {
    id: 'apply-recurring-transactions',
    title: 'Apply recurring transaction templates for this month',
    priority: 'high',
    tags: ['transactions', 'recurring', 'cashflow'],
    recurrence: 'monthly',
    listId: 'Transactions',
    linkedPage: 'Transactions',
  },
  {
    id: 'check-transaction-intelligence',
    title: 'Review transaction intelligence signals (spend, refunds, merchants)',
    priority: 'medium',
    tags: ['analysis', 'transactions', 'intelligence'],
    recurrence: 'monthly',
    listId: 'Analysis',
    linkedPage: 'Analysis',
  },
  {
    id: 'reconcile-cash-accounts',
    title: 'Reconcile cash account balance drift (transactions vs balances)',
    priority: 'high',
    tags: ['accounts', 'reconciliation', 'cashflow'],
    recurrence: 'monthly',
    listId: 'Accounts',
    linkedPage: 'Accounts',
  },

  // --- Statements & ingestion ---
  {
    id: 'upload-bank-statements',
    title: 'Upload bank statements (new month / missing history)',
    priority: 'medium',
    tags: ['statements', 'bank', 'ingestion'],
    recurrence: 'monthly',
    listId: 'Statements',
    linkedPage: 'Statement Upload',
  },
  {
    id: 'upload-trading-statements',
    title: 'Upload trading/investment statements (broker activity)',
    priority: 'medium',
    tags: ['statements', 'investments', 'ingestion'],
    recurrence: 'monthly',
    listId: 'Statements',
    linkedPage: 'Statement Upload',
  },
  {
    id: 'review-statement-import-results',
    title: 'Review statement import results and resolve parsing issues',
    priority: 'high',
    tags: ['statements', 'errors', 'quality'],
    recurrence: 'monthly',
    listId: 'Statements',
    linkedPage: 'Statement History',
  },

  // --- Investments & portfolio engines ---
  {
    id: 'rebalance',
    title: 'Check portfolio drift vs plan (rebalance / adjust)',
    priority: 'medium',
    tags: ['investments', 'rebalance', 'wealth'],
    recurrence: 'monthly',
    listId: 'Investments',
    linkedPage: 'Investments',
  },
  {
    id: 'check-wealth-ultra-rebalancer',
    title: 'Review Wealth Ultra sleeve/risk rebalancing recommendations',
    priority: 'medium',
    tags: ['wealth-ultra', 'risk', 'rebalancing', 'investments'],
    recurrence: 'monthly',
    listId: 'Wealth Ultra',
    linkedPage: 'Wealth Ultra',
  },
  {
    id: 'check-ai-rebalancer',
    title: 'Review AI Rebalancer recommendations (confirm before acting)',
    priority: 'medium',
    tags: ['ai', 'rebalancer', 'investments'],
    recurrence: 'monthly',
    listId: 'AI Rebalancer',
    linkedPage: 'AI Rebalancer',
  },
  {
    id: 'check-risk-trading-hub',
    title: 'Review risk & trading hub insights (policy gates, drift, approvals)',
    priority: 'medium',
    tags: ['risk', 'trading', 'policy', 'investments'],
    recurrence: 'monthly',
    listId: 'Risk & Trading',
    linkedPage: 'Wealth Ultra',
  },
  {
    id: 'execute-investment-plan',
    title: 'Execute / reschedule planned investment trades (if targets met)',
    priority: 'high',
    tags: ['plan', 'trades', 'execution', 'investments'],
    recurrence: 'monthly',
    listId: 'Plans',
    linkedPage: 'Investment Plan',
  },
  {
    id: 'review-watchlist',
    title: 'Review watchlist symbols (keep it current)',
    priority: 'low',
    tags: ['watchlist', 'symbols', 'investments'],
    recurrence: 'weekly',
    listId: 'Watchlist',
    linkedPage: 'Watchlist',
  },
  {
    id: 'refresh-watchlist-quotes',
    title: 'Refresh watchlist quotes and verify stale symbols',
    priority: 'medium',
    tags: ['watchlist', 'quotes', 'stale', 'market'],
    recurrence: 'weekly',
    listId: 'Watchlist',
    linkedPage: 'Watchlist',
  },
  {
    id: 'review-dividend-tracker',
    title: 'Review dividend tracker metrics (MWRR / yield on cost / PnL)',
    priority: 'medium',
    tags: ['dividends', 'performance', 'mwrr', 'investments'],
    recurrence: 'monthly',
    listId: 'Dividend Tracker',
    linkedPage: 'Dividend Tracker',
  },
  {
    id: 'review-recovery-plan',
    title: 'Review recovery plan for losing positions (actions & expectations)',
    priority: 'high',
    tags: ['recovery', 'positions', 'risk', 'liquidation'],
    recurrence: 'monthly',
    listId: 'Recovery Plan',
    linkedPage: 'Recovery Plan',
  },

  // --- Market events & planning ---
  {
    id: 'refresh-market-events',
    title: 'Refresh market events calendar and review upcoming items',
    priority: 'medium',
    tags: ['market', 'events', 'calendar', 'macro'],
    recurrence: 'weekly',
    listId: 'Market Events',
    linkedPage: 'Market Events',
  },
  {
    id: 'review-forecast-assumptions',
    title: 'Update forecast assumptions (income, savings, net worth baseline)',
    priority: 'medium',
    tags: ['forecast', 'assumptions'],
    recurrence: 'monthly',
    listId: 'Forecast',
    linkedPage: 'Forecast',
  },
  {
    id: 'run-forecast',
    title: 'Run forecast and compare scenarios',
    priority: 'high',
    tags: ['forecast', 'scenarios', 'projections'],
    recurrence: 'monthly',
    listId: 'Forecast',
    linkedPage: 'Forecast',
  },

  // --- Goals ---
  {
    id: 'review-goals',
    title: 'Review goal progress and adjust monthly contributions',
    priority: 'high',
    tags: ['goals', 'contributions', 'progress'],
    recurrence: 'monthly',
    listId: 'Goals',
    linkedPage: 'Goals',
  },
  {
    id: 'check-goals-allocation-rules',
    title: 'Check goal allocation waterfall & constraints (weak cashflow, 0% nudge)',
    priority: 'medium',
    tags: ['goals', 'allocation', 'waterfall'],
    recurrence: 'monthly',
    listId: 'Goals',
    linkedPage: 'Goals',
  },
  {
    id: 'run-goal-ai-plan',
    title: 'Generate/refresh AI goal plan (verify assumptions before accepting)',
    priority: 'medium',
    tags: ['ai', 'goals', 'planning'],
    recurrence: 'monthly',
    listId: 'Goals',
    linkedPage: 'Goals',
  },

  // --- Zakat ---
  {
    id: 'zakat',
    title: 'Review Zakat eligibility and payments',
    priority: 'medium',
    tags: ['zakat', 'eligibility', 'ledger'],
    recurrence: 'none',
    listId: 'Zakat',
    linkedPage: 'Zakat',
  },
  {
    id: 'verify-zakatable-assets',
    title: 'Verify zakatable assets classification (investments/commodities/liquid holdings)',
    priority: 'high',
    tags: ['zakat', 'assets', 'classification'],
    recurrence: 'none',
    listId: 'Zakat',
    linkedPage: 'Zakat',
  },

  // --- Liabilities & cash efficiency ---
  {
    id: 'review-liabilities',
    title: 'Review liabilities (debt vs assets, cash vs debt, debt service)',
    priority: 'medium',
    tags: ['liabilities', 'debt', 'ratios'],
    recurrence: 'monthly',
    listId: 'Liabilities',
    linkedPage: 'Liabilities',
  },
  {
    id: 'plan-debt-servicing',
    title: 'Plan debt servicing / payment schedule (reduce burden if possible)',
    priority: 'low',
    tags: ['debt', 'payments', 'planning'],
    recurrence: 'monthly',
    listId: 'Liabilities',
    linkedPage: 'Liabilities',
  },

  // --- Commodities & asset linkage ---
  {
    id: 'check-commodity-goal-linkage',
    title: 'Check commodity-to-goal linkage (ensure goal_id persists after edits)',
    priority: 'low',
    tags: ['commodities', 'goals', 'linkage'],
    recurrence: 'none',
    listId: 'Commodities',
    linkedPage: 'Commodities',
  },

  // --- Home / bills ---
  {
    id: 'bills',
    title: 'Pay recurring bills',
    priority: 'high',
    tags: ['bills', 'home', 'cashflow'],
    recurrence: 'monthly',
    listId: 'Home',
    linkedPage: 'Budgets',
  },

  // --- Admin / backup / reliability ---
  {
    id: 'backup',
    title: 'Export Finova backup',
    priority: 'low',
    tags: ['admin', 'backup', 'reliability'],
    recurrence: 'none',
    listId: 'Admin',
    linkedPage: 'Engines & Tools',
  },
  {
    id: 'review-system-health',
    title: 'Review system health & data trust diagnostics (stale data, FX, reconciliation)',
    priority: 'high',
    tags: ['system', 'health', 'diagnostics', 'fx', 'reconciliation'],
    recurrence: 'weekly',
    listId: 'System Health',
    linkedPage: 'System & APIs Health',
  },
  {
    id: 'review-settings',
    title: 'Review Settings (mask balances, FX confirmations, notification toggles)',
    priority: 'low',
    tags: ['settings', 'privacy', 'notifications'],
    recurrence: 'none',
    listId: 'Settings',
    linkedPage: 'Settings',
  },

  // --- Transactions operational tasks ---
  {
    id: 'review-pending-transactions',
    title: 'Review pending transaction approvals (restricted accounts)',
    priority: 'high',
    tags: ['transactions', 'approvals', 'admin'],
    recurrence: 'none',
    listId: 'Transactions',
    linkedPage: 'Transactions',
  },
  {
    id: 'check-refund-pairs',
    title: 'Review possible refund pairs and fix categorization',
    priority: 'medium',
    tags: ['transactions', 'refunds', 'analysis'],
    recurrence: 'monthly',
    listId: 'Analysis',
    linkedPage: 'Analysis',
  },
  {
    id: 'review-merchants-and-categories',
    title: 'Review merchants & spending categories for sanity checks',
    priority: 'medium',
    tags: ['transactions', 'merchants', 'categories'],
    recurrence: 'monthly',
    listId: 'Analysis',
    linkedPage: 'Analysis',
  },

  // --- Assets / net worth housekeeping ---
  {
    id: 'review-assets',
    title: 'Review asset balances & classifications',
    priority: 'medium',
    tags: ['assets', 'net-worth'],
    recurrence: 'monthly',
    listId: 'Assets',
    linkedPage: 'Assets',
  },
  {
    id: 'review-dash-summary-snapshot',
    title: 'Review Dashboard/Summary snapshot (headline KPIs look reasonable)',
    priority: 'low',
    tags: ['dashboard', 'summary', 'sanity'],
    recurrence: 'weekly',
    listId: 'Dashboard',
    linkedPage: 'Summary',
  },

  // --- Engines & tools / page helpers ---
  {
    id: 'run-shock-drill',
    title: 'Run a shock drill template (stress check cashflow resilience)',
    priority: 'medium',
    tags: ['shock', 'stress', 'simulation'],
    recurrence: 'none',
    listId: 'System',
    linkedPage: 'Summary',
  },
];
