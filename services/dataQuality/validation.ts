/**
 * Shared validation for financial data. Use before persisting to ensure accuracy.
 */

const AMOUNT_EPSILON = 0.0001;
const MAX_NAME_LEN = 200;
const MAX_DESC_LEN = 500;
const VALID_ACCOUNT_TYPES = ['Checking', 'Savings', 'Investment', 'Credit'] as const;
const VALID_RISK_PROFILES = ['Conservative', 'Moderate', 'Aggressive'] as const;
const VALID_LIABILITY_TYPES = ['Mortgage', 'Loan', 'Credit Card', 'Personal Loan', 'Receivable'] as const;
const VALID_LIABILITY_STATUS = ['Active', 'Paid'] as const;
const VALID_ASSET_TYPES = ['Cash', 'Sukuk', 'Property', 'Land', 'Vehicle', 'Jewelry', 'Artworks and collectibles', 'Islamic finance instruments', 'Accounts receivable', 'Household Goods', 'Electronics', 'Other'] as const;
const VALID_TRADE_TYPES = ['buy', 'sell'] as const;
const VALID_CONDITION_TYPES = ['price', 'date'] as const;
const VALID_PRIORITIES = ['High', 'Medium', 'Low'] as const;
const VALID_TICKER_STATUSES = ['Core', 'High-Upside', 'Watchlist', 'Quarantine', 'Speculative', 'Excluded'] as const;

export function safeNumber(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

export function isValidDate(d: unknown): boolean {
  if (!d) return false;
  const t = new Date(d as string | number).getTime();
  return !Number.isNaN(t) && t > 0;
}

export function isValidYearRange(d: unknown, min = 1990, max = 2100): boolean {
  if (!isValidDate(d)) return false;
  const y = new Date(d as string | number).getFullYear();
  return y >= min && y <= max;
}

/** Validate account before add/update.
 * Set opts.allowNegativeBalance when balance is driven by transaction deltas (expense flow) to avoid rejecting valid ledger updates. */
export function validateAccount(
  input: { name?: string; type?: string; balance?: unknown },
  opts?: { allowNegativeBalance?: boolean }
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const name = String(input.name ?? '').trim();
  if (!name) errors.push('Account name is required.');
  else if (name.length > MAX_NAME_LEN) errors.push(`Account name must be at most ${MAX_NAME_LEN} characters.`);

  const type = input.type;
  if (!type || !VALID_ACCOUNT_TYPES.includes(type as any)) {
    errors.push(`Account type must be one of: ${VALID_ACCOUNT_TYPES.join(', ')}.`);
  }

  const bal = safeNumber(input.balance, NaN);
  if (Number.isNaN(bal) || !Number.isFinite(bal)) {
    errors.push('Balance must be a valid number.');
  } else if (bal < 0 && type !== 'Credit' && !opts?.allowNegativeBalance) {
    errors.push('Balance cannot be negative.'); // Credit accounts (credit cards) use negative balances for debt
  }

  return { valid: errors.length === 0, errors };
}

/** Validate goal before add/update */
export function validateGoal(input: { name?: string; targetAmount?: unknown; currentAmount?: unknown; deadline?: string }): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const name = String(input.name ?? '').trim();
  if (!name) errors.push('Goal name is required.');
  else if (name.length > MAX_NAME_LEN) errors.push(`Goal name must be at most ${MAX_NAME_LEN} characters.`);

  const target = safeNumber(input.targetAmount, NaN);
  if (Number.isNaN(target) || target <= 0) errors.push('Target amount must be a positive number.');

  const current = safeNumber(input.currentAmount, NaN);
  if (Number.isNaN(current) || current < 0) errors.push('Current amount cannot be negative.');

  if (!input.deadline || String(input.deadline).trim() === '') {
    errors.push('Deadline is required.');
  } else if (!isValidDate(input.deadline)) {
    errors.push('Deadline must be a valid date.');
  }

  return { valid: errors.length === 0, errors };
}

/** Validate holding before add/update */
export function validateHolding(input: { symbol?: string; quantity?: unknown; avgCost?: unknown; currentValue?: unknown; portfolio_id?: string; portfolioId?: string; holdingType?: string; holding_type?: string }): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const holdingType = input.holdingType ?? input.holding_type ?? 'ticker';
  if (holdingType === 'ticker') {
    const sym = String(input.symbol ?? '').trim().toUpperCase();
    if (!sym) errors.push('Symbol is required for ticker holdings.');
  }

  const qty = safeNumber(input.quantity, NaN);
  if (Number.isNaN(qty) || qty < 0) errors.push('Quantity cannot be negative.');

  const avgCost = safeNumber(input.avgCost, NaN);
  if (Number.isNaN(avgCost) || avgCost < 0) errors.push('Average cost cannot be negative.');

  const currentVal = safeNumber(input.currentValue, NaN);
  if (Number.isNaN(currentVal) || currentVal < 0) errors.push('Current value cannot be negative.');

  const pid = input.portfolio_id ?? input.portfolioId;
  if (!pid || String(pid).trim() === '') errors.push('Portfolio is required.');

  return { valid: errors.length === 0, errors };
}

/** Validate liability before add/update */
export function validateLiability(input: { name?: string; type?: string; amount?: unknown; status?: string }): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const name = String(input.name ?? '').trim();
  if (!name) errors.push('Liability name is required.');
  else if (name.length > MAX_NAME_LEN) errors.push(`Liability name must be at most ${MAX_NAME_LEN} characters.`);

  if (!input.type || !VALID_LIABILITY_TYPES.includes(input.type as any)) {
    errors.push(`Liability type must be one of: ${VALID_LIABILITY_TYPES.join(', ')}.`);
  }
  if (!input.status || !VALID_LIABILITY_STATUS.includes(input.status as any)) {
    errors.push(`Status must be one of: ${VALID_LIABILITY_STATUS.join(', ')}.`);
  }

  const amt = safeNumber(input.amount, NaN);
  if (Number.isNaN(amt) || !Number.isFinite(amt)) {
    errors.push('Liability amount must be a valid number.');
  } else if (Math.abs(amt) < AMOUNT_EPSILON) {
    errors.push('Liability amount must be non-zero.');
  } else if (input.type === 'Receivable') {
    if (amt <= 0) errors.push('Receivable amount must be positive (money owed to you).');
  } else if (input.type && VALID_LIABILITY_TYPES.includes(input.type as any)) {
    // Debt (Mortgage, Loan, Credit Card, Personal Loan): stored negative; see Liabilities.tsx + normalizeLiability
    if (amt >= 0) errors.push('Debt liability amount must be negative (outstanding balance owed).');
  }

  return { valid: errors.length === 0, errors };
}

/** Validate commodity holding before add/update */
export function validateCommodityHolding(input: { name?: string; quantity?: unknown; purchaseValue?: unknown; currentValue?: unknown; symbol?: string }): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const name = String(input.name ?? '').trim();
  if (!name) errors.push('Commodity name is required.');

  const qty = safeNumber(input.quantity, NaN);
  if (Number.isNaN(qty) || qty < 0) errors.push('Quantity cannot be negative.');

  const purchase = safeNumber(input.purchaseValue, NaN);
  if (Number.isNaN(purchase) || purchase <= 0) errors.push('Purchase value must be a positive number.');

  const current = safeNumber(input.currentValue, NaN);
  if (Number.isNaN(current) || current < 0) errors.push('Current value cannot be negative.');

  const sym = String(input.symbol ?? '').trim();
  if (!sym) errors.push('Symbol is required (e.g. XAU_GRAM_24K, BTC_USD).');

  return { valid: errors.length === 0, errors };
}

/** Validate investment trade (buy/sell/dividend) */
export function validateTrade(input: {
  type?: string;
  quantity?: unknown;
  price?: unknown;
  total?: unknown;
  symbol?: string;
  date?: string;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const type = input.type;
  const isCashFlow = type === 'deposit' || type === 'withdrawal' || type === 'fee' || type === 'vat';

  if (isCashFlow) {
    const total = safeNumber(input.total, NaN);
    if (Number.isNaN(total) || total <= 0) errors.push(`${type === 'fee' || type === 'vat' ? 'Fee/VAT' : 'Deposit/withdrawal'} amount must be a positive number.`);
  } else if (type === 'dividend') {
    const total = safeNumber(input.total, NaN);
    if (Number.isNaN(total) || total <= 0) errors.push('Dividend cash amount must be a positive number.');
    const sym = String(input.symbol ?? '').trim().toUpperCase();
    if (!sym || sym === 'CASH') errors.push('Symbol is required for dividend entries.');
    if (input.date && String(input.date).trim() !== '' && !isValidYearRange(input.date)) {
      errors.push('Dividend date year must be between 1990 and 2100.');
    }
  } else {
    const qty = safeNumber(input.quantity, NaN);
    if (Number.isNaN(qty) || qty <= 0) errors.push('Trade quantity must be greater than zero.');

    const price = safeNumber(input.price, NaN);
    if (Number.isNaN(price) || price < 0) errors.push('Trade price cannot be negative.');

    const sym = String(input.symbol ?? '').trim().toUpperCase();
    if (!sym || sym === 'CASH') errors.push('Symbol is required for buy/sell trades.');
  }

  return { valid: errors.length === 0, errors };
}

/** Validate transaction (core fields) */
export function validateTransactionCore(input: { date?: string; amount?: unknown; accountId?: string; description?: string }): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!input.date || String(input.date).trim() === '') errors.push('Date is required.');
  else if (!isValidYearRange(input.date)) errors.push('Date year must be between 1990 and 2100.');

  const amt = safeNumber(input.amount, NaN);
  if (Number.isNaN(amt) || !Number.isFinite(amt)) errors.push('Amount must be a valid number.');
  else if (Math.abs(amt) < AMOUNT_EPSILON) errors.push('Amount must be greater than zero.');

  const desc = String(input.description ?? '').trim();
  if (desc.length > MAX_DESC_LEN) errors.push(`Description must be at most ${MAX_DESC_LEN} characters.`);

  if (!input.accountId || String(input.accountId).trim() === '') errors.push('Account is required.');

  return { valid: errors.length === 0, errors };
}

/** Validate settings (gold price, nisab) */
export function validateSettings(input: { goldPrice?: unknown; nisabAmount?: unknown; budgetThreshold?: unknown; driftThreshold?: unknown; riskProfile?: string }): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const gold = safeNumber(input.goldPrice, NaN);
  if (input.goldPrice != null && (Number.isNaN(gold) || gold <= 0 || gold > 1e6)) {
    errors.push('Gold price must be a positive number (e.g. 275 SAR/gram).');
  }

  const nisab = safeNumber(input.nisabAmount, NaN);
  if (input.nisabAmount != null && input.nisabAmount !== '' && (Number.isNaN(nisab) || nisab < 0)) {
    errors.push('Nisab amount cannot be negative.');
  }

  const budget = safeNumber(input.budgetThreshold, NaN);
  if (input.budgetThreshold != null && (Number.isNaN(budget) || budget < 0 || budget > 100)) {
    errors.push('Budget threshold must be between 0 and 100.');
  }

  const drift = safeNumber(input.driftThreshold, NaN);
  if (input.driftThreshold != null && (Number.isNaN(drift) || drift < 0 || drift > 100)) {
    errors.push('Drift threshold must be between 0 and 100.');
  }

  const rp = input.riskProfile;
  if (rp != null && rp !== '' && !VALID_RISK_PROFILES.includes(rp as any)) {
    errors.push(`Risk profile must be one of: ${VALID_RISK_PROFILES.join(', ')}.`);
  }

  return { valid: errors.length === 0, errors };
}

const MAX_ASSET_NOTES_LEN = 5000;

/** Validate asset before add/update */
export function validateAsset(input: {
  name?: string;
  type?: string;
  value?: unknown;
  issueDate?: string;
  maturityDate?: string;
  notes?: string;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const name = String(input.name ?? '').trim();
  if (!name) errors.push('Asset name is required.');
  else if (name.length > MAX_NAME_LEN) errors.push(`Asset name must be at most ${MAX_NAME_LEN} characters.`);

  const notesStr = input.notes != null ? String(input.notes) : '';
  if (notesStr.length > MAX_ASSET_NOTES_LEN) {
    errors.push(`Notes must be at most ${MAX_ASSET_NOTES_LEN} characters.`);
  }

  const type = input.type;
  if (!type || !VALID_ASSET_TYPES.includes(type as any)) {
    errors.push(`Asset type must be one of: ${VALID_ASSET_TYPES.join(', ')}.`);
  }

  const val = safeNumber(input.value, NaN);
  if (Number.isNaN(val) || !Number.isFinite(val)) errors.push('Asset value must be a valid number.');
  else if (val < 0) errors.push('Asset value cannot be negative.');

  const isoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
  if (type === 'Sukuk') {
    const issue = String(input.issueDate ?? '').trim();
    const maturity = String(input.maturityDate ?? '').trim();
    if (!issue) errors.push('Sukuk requires an issue (or subscription) date (YYYY-MM-DD).');
    else if (!isoDate(issue)) errors.push('Sukuk issue date must be a complete calendar date (YYYY-MM-DD).');
    if (!maturity) errors.push('Sukuk requires a maturity date (YYYY-MM-DD).');
    else if (!isoDate(maturity)) errors.push('Sukuk maturity date must be a complete calendar date (YYYY-MM-DD).');
    if (issue && maturity && isoDate(issue) && isoDate(maturity) && issue > maturity) {
      errors.push('Sukuk maturity date must be on or after the issue date.');
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Validate planned trade before add/update */
export function validatePlannedTrade(input: { symbol?: string; name?: string; tradeType?: string; conditionType?: string; targetValue?: unknown; quantity?: unknown; amount?: unknown; priority?: string }): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const sym = String(input.symbol ?? '').trim().toUpperCase();
  if (!sym) errors.push('Symbol is required.');

  const name = String(input.name ?? '').trim();
  if (!name) errors.push('Name is required.');
  else if (name.length > MAX_NAME_LEN) errors.push(`Name must be at most ${MAX_NAME_LEN} characters.`);

  if (!input.tradeType || !VALID_TRADE_TYPES.includes(input.tradeType as any)) {
    errors.push('Trade type must be buy or sell.');
  }

  if (!input.conditionType || !VALID_CONDITION_TYPES.includes(input.conditionType as any)) {
    errors.push('Condition type must be price or date.');
  }

  const targetVal = input.targetValue;
  if (targetVal == null || targetVal === '') errors.push('Target value is required.');
  else if (input.conditionType === 'price') {
    const n = safeNumber(targetVal, NaN);
    if (Number.isNaN(n) || n <= 0) errors.push('Target price must be a positive number.');
  } else if (input.conditionType === 'date') {
    const d = new Date(targetVal as string | number);
    if (Number.isNaN(d.getTime())) errors.push('Target date must be a valid date.');
  }

  const qty = safeNumber(input.quantity, NaN);
  const amt = safeNumber(input.amount, NaN);
  const hasValidQty = Number.isFinite(qty) && qty > 0;
  const hasValidAmt = Number.isFinite(amt) && amt > 0;
  if (!hasValidQty && !hasValidAmt) {
    errors.push('Specify either quantity or amount (both must be positive).');
  }

  if (!input.priority || !VALID_PRIORITIES.includes(input.priority as any)) {
    errors.push(`Priority must be one of: ${VALID_PRIORITIES.join(', ')}.`);
  }

  return { valid: errors.length === 0, errors };
}

/** Validate ticker status (for updateUniverseTickerStatus) */
export function validateTickerStatus(status: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!status || !VALID_TICKER_STATUSES.includes(status as any)) {
    errors.push(`Status must be one of: ${VALID_TICKER_STATUSES.join(', ')}.`);
  }
  return { valid: errors.length === 0, errors };
}

/** Validate universe ticker before add */
export function validateUniverseTicker(input: { ticker?: string; name?: string; status?: string }): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const ticker = String(input.ticker ?? '').trim().toUpperCase();
  if (!ticker) errors.push('Ticker symbol is required.');

  const name = String(input.name ?? '').trim();
  if (!name) errors.push('Ticker name is required.');
  else if (name.length > MAX_NAME_LEN) errors.push(`Name must be at most ${MAX_NAME_LEN} characters.`);

  if (!input.status || !VALID_TICKER_STATUSES.includes(input.status as any)) {
    errors.push(`Status must be one of: ${VALID_TICKER_STATUSES.join(', ')}.`);
  }

  return { valid: errors.length === 0, errors };
}

/** Validate recurring transaction before add/update */
export function validateRecurringTransaction(input: { description?: string; amount?: unknown; type?: string; accountId?: string; category?: string; dayOfMonth?: unknown }): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const desc = String(input.description ?? '').trim();
  if (!desc) errors.push('Description is required.');
  else if (desc.length > MAX_DESC_LEN) errors.push(`Description must be at most ${MAX_DESC_LEN} characters.`);

  const amt = safeNumber(input.amount, NaN);
  if (Number.isNaN(amt) || !Number.isFinite(amt)) errors.push('Amount must be a valid number.');
  else if (amt <= 0) errors.push('Amount must be greater than zero.');

  if (input.type !== 'income' && input.type !== 'expense') errors.push('Type must be income or expense.');

  if (!input.accountId || String(input.accountId).trim() === '') errors.push('Account is required.');

  const cat = String(input.category ?? '').trim();
  if (!cat) errors.push('Category is required.');

  const day = Number(input.dayOfMonth);
  if (!Number.isFinite(day) || day < 1 || day > 28) errors.push('Day of month must be between 1 and 28.');

  return { valid: errors.length === 0, errors };
}

/** Validate price alert before add */
export function validatePriceAlert(input: { symbol?: string; targetPrice?: unknown }): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const sym = String(input.symbol ?? '').trim().toUpperCase();
  if (!sym) errors.push('Symbol is required.');

  const price = safeNumber(input.targetPrice, NaN);
  if (Number.isNaN(price) || !Number.isFinite(price) || price <= 0) errors.push('Target price must be a positive number.');

  return { valid: errors.length === 0, errors };
}

/** Validate zakat payment before add */
export function validateZakatPayment(input: { date?: string; amount?: unknown }): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!input.date || String(input.date).trim() === '') errors.push('Date is required.');
  else if (!isValidYearRange(input.date)) errors.push('Date year must be between 1990 and 2100.');

  const amt = safeNumber(input.amount, NaN);
  if (Number.isNaN(amt) || !Number.isFinite(amt)) errors.push('Amount must be a valid number.');
  else if (amt <= 0) errors.push('Amount must be greater than zero.');

  return { valid: errors.length === 0, errors };
}

/** Validate watchlist item before add */
export function validateWatchlistItem(input: { symbol?: string }): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const sym = String(input.symbol ?? '').trim().toUpperCase();
  if (!sym) errors.push('Symbol is required.');
  return { valid: errors.length === 0, errors };
}

/** Validate goal allocation (savingsAllocationPercent 0-100) */
export function validateGoalAllocation(input: { savingsAllocationPercent?: unknown }): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const pct = safeNumber(input.savingsAllocationPercent, NaN);
  if (Number.isNaN(pct) || !Number.isFinite(pct)) errors.push('Allocation must be a valid number.');
  else if (pct < 0 || pct > 100) errors.push('Allocation must be between 0 and 100.');
  return { valid: errors.length === 0, errors };
}

/** Validate investment portfolio before add/update */
export function validatePortfolio(input: { name?: string; accountId?: string }): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const name = String(input.name ?? '').trim();
  if (!name) errors.push('Portfolio name is required.');
  else if (name.length > MAX_NAME_LEN) errors.push(`Portfolio name must be at most ${MAX_NAME_LEN} characters.`);

  if (!input.accountId || String(input.accountId).trim() === '') {
    errors.push('Account is required.');
  }

  return { valid: errors.length === 0, errors };
}

/** Validate investment plan settings before save */
export function validateInvestmentPlan(input: { monthlyBudget?: unknown; coreAllocation?: unknown; upsideAllocation?: unknown; minimumUpsidePercentage?: unknown; stale_days?: unknown; min_coverage_threshold?: unknown }): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const budget = safeNumber(input.monthlyBudget, NaN);
  if (input.monthlyBudget != null && (Number.isNaN(budget) || budget < 0)) {
    errors.push('Monthly budget cannot be negative.');
  }

  const core = safeNumber(input.coreAllocation, NaN);
  const upside = safeNumber(input.upsideAllocation, NaN);
  if (input.coreAllocation != null && input.upsideAllocation != null) {
    const sum = core + upside;
    if (!Number.isFinite(core) || !Number.isFinite(upside) || core < 0 || upside < 0) {
      errors.push('Core and upside allocations must be valid non-negative numbers.');
    } else if (Math.abs(sum - 1) > 0.01) {
      errors.push('Core + upside allocations should sum to 100% (e.g. 0.7 + 0.3).');
    }
  }

  const minUpside = safeNumber(input.minimumUpsidePercentage, NaN);
  if (input.minimumUpsidePercentage != null && (Number.isNaN(minUpside) || minUpside < 0 || minUpside > 100)) {
    errors.push('Minimum upside percentage must be between 0 and 100.');
  }

  const stale = safeNumber(input.stale_days, NaN);
  if (input.stale_days != null && (Number.isNaN(stale) || stale < 0 || stale > 365)) {
    errors.push('Stale days must be between 0 and 365.');
  }

  const coverage = safeNumber(input.min_coverage_threshold, NaN);
  if (
    input.min_coverage_threshold != null &&
    (Number.isNaN(coverage) || !Number.isFinite(coverage) || coverage < 0 || coverage > 50 || !Number.isInteger(coverage))
  ) {
    errors.push('Min analyst coverage must be a non-negative integer (typically 2–5).');
  }

  return { valid: errors.length === 0, errors };
}

/** Validate execution log before persist (system-generated; sanity bounds only) */
export function validateExecutionLog(input: {
  date?: string;
  totalInvestment?: unknown;
  status?: string;
  trades?: unknown;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const d = input.date ? new Date(input.date) : null;
  if (!input.date || !d || Number.isNaN(d.getTime())) {
    errors.push('Execution log date must be a valid date.');
  }
  const total = safeNumber(input.totalInvestment, NaN);
  if (Number.isNaN(total) || total < 0 || total > 1e12) {
    errors.push('Total investment must be a valid non-negative amount.');
  }
  if (input.status && input.status !== 'success' && input.status !== 'failure') {
    errors.push('Execution status must be success or failure.');
  }
  if (input.trades != null && !Array.isArray(input.trades)) {
    errors.push('Trades must be an array.');
  }
  return { valid: errors.length === 0, errors };
}

const VALID_BUDGET_PERIODS = ['monthly', 'yearly', 'weekly', 'daily'] as const;

/** Validate budget before add/update */
export function validateBudget(input: { category?: string; month?: unknown; year?: unknown; limit?: unknown; period?: string }): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const cat = String(input.category ?? '').trim();
  if (!cat) errors.push('Budget category is required.');

  const month = Number(input.month);
  if (!Number.isFinite(month) || month < 1 || month > 12) errors.push('Month must be between 1 and 12.');

  const year = Number(input.year);
  if (!Number.isFinite(year) || year < 1990 || year > 2100) errors.push('Year must be between 1990 and 2100.');

  const limit = safeNumber(input.limit, NaN);
  if (Number.isNaN(limit) || limit <= 0) errors.push('Budget limit must be a positive number.');

  if (input.period != null && input.period !== '') {
    if (!VALID_BUDGET_PERIODS.includes(input.period as any)) {
      errors.push(`Budget period must be one of: ${VALID_BUDGET_PERIODS.join(', ')}.`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Sanity-check backup before restore */
export function validateBackup(backup: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!backup || typeof backup !== 'object') {
    return { valid: false, errors: ['Backup must be a valid JSON object.'] };
  }
  const b = backup as Record<string, unknown>;
  if (!Array.isArray(b.accounts) && !Array.isArray(b.transactions) && !Array.isArray(b.goals) && typeof b.settings !== 'object') {
    errors.push('Backup must contain at least accounts, transactions, goals, or settings.');
  }
  if (Array.isArray(b.accounts)) {
    for (let i = 0; i < Math.min(b.accounts.length, 5); i++) {
      const a = b.accounts[i] as any;
      if (a && typeof a === 'object') {
        const v = validateAccount({ name: a.name, type: a.type, balance: a.balance });
        if (!v.valid && i === 0) errors.push(`Account validation: ${v.errors[0]}`);
      }
    }
  }
  if (Array.isArray(b.transactions)) {
    for (let i = 0; i < Math.min(b.transactions.length, 3); i++) {
      const t = b.transactions[i] as any;
      if (t && typeof t === 'object') {
        const v = validateTransactionCore({ date: t.date, amount: t.amount, accountId: t.accountId ?? t.account_id, description: t.description });
        if (!v.valid && i === 0) errors.push(`Transaction validation: ${v.errors[0]}`);
      }
    }
  }
  if (Array.isArray(b.liabilities)) {
    for (let i = 0; i < Math.min(b.liabilities.length, 3); i++) {
      const l = b.liabilities[i] as any;
      if (l && typeof l === 'object') {
        const v = validateLiability({ name: l.name, type: l.type, amount: l.amount ?? l.balance, status: l.status });
        if (!v.valid && i === 0) errors.push(`Liability validation: ${v.errors[0]}`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}
