import type { InvestmentTransaction, Transaction } from '../types';

export function confirmDetailsForTransaction(tx: {
  date?: string;
  description?: string;
  amount?: number;
  type?: string;
  accountId?: string;
  accountName?: string;
  budgetCategory?: string;
}): string[] {
  const lines: string[] = [];
  if (tx.date) lines.push(`Date: ${tx.date}`);
  if (tx.description) lines.push(`Description: ${tx.description}`);
  if (tx.type) lines.push(`Type: ${tx.type}`);
  if (tx.amount != null && Number.isFinite(tx.amount)) lines.push(`Amount: ${tx.amount}`);
  if (tx.accountName) lines.push(`Account: ${tx.accountName}`);
  if (tx.budgetCategory) lines.push(`Budget: ${tx.budgetCategory}`);
  return lines;
}

export function confirmDetailsForInvestmentTrade(trade: {
  type?: string;
  symbol?: string;
  date?: string;
  total?: number;
  quantity?: number;
  price?: number;
  currency?: string;
  portfolioName?: string;
  accountName?: string;
}): string[] {
  const lines: string[] = [];
  if (trade.type) lines.push(`Type: ${trade.type}`);
  if (trade.symbol) lines.push(`Symbol: ${trade.symbol}`);
  if (trade.date) lines.push(`Date: ${trade.date}`);
  if (trade.portfolioName) lines.push(`Portfolio: ${trade.portfolioName}`);
  if (trade.accountName) lines.push(`Platform: ${trade.accountName}`);
  if (trade.type === 'dividend' && trade.total != null) {
    lines.push(`Cash amount: ${trade.total} ${trade.currency ?? ''}`.trim());
  } else if (trade.quantity != null && trade.price != null) {
    lines.push(`Qty × price: ${trade.quantity} × ${trade.price} ${trade.currency ?? ''}`.trim());
    if (trade.total != null && trade.total > 0) lines.push(`Total: ${trade.total} ${trade.currency ?? ''}`.trim());
  } else if (trade.total != null) {
    lines.push(`Amount: ${trade.total} ${trade.currency ?? ''}`.trim());
  }
  return lines;
}

export type ConfirmActionPayload = {
  title: string;
  message: string;
  details?: string[];
  variant?: 'primary' | 'danger';
  confirmLabel?: string;
};

export function confirmTitleForInvestmentType(type: string): string {
  switch (type) {
    case 'dividend':
      return 'Record dividend?';
    case 'buy':
      return 'Record buy?';
    case 'sell':
      return 'Record sell?';
    case 'deposit':
      return 'Record deposit?';
    case 'withdrawal':
      return 'Record withdrawal?';
    case 'fee':
      return 'Record fee?';
    case 'vat':
      return 'Record VAT?';
    default:
      return 'Record investment activity?';
  }
}

export function summarizeTransactionForConfirm(tx: Transaction, accountName?: string): ConfirmActionPayload {
  return {
    title: tx.id ? 'Save transaction changes?' : 'Add transaction?',
    message: tx.id
      ? 'Update this transaction in your ledger?'
      : 'Add this transaction to your ledger?',
    details: confirmDetailsForTransaction({
      date: tx.date,
      description: tx.description,
      amount: tx.amount,
      type: tx.type,
      accountName,
      budgetCategory: tx.budgetCategory,
    }),
  };
}

export function summarizeTransferForConfirm(args: {
  amount: number;
  fromName: string;
  toName: string;
  fromCurrency: string;
  feeAmount?: number;
  convertedAmount?: number;
  toCurrency?: string;
  note?: string;
}): ConfirmActionPayload {
  const lines = [
    `From: ${args.fromName}`,
    `To: ${args.toName}`,
    `Amount: ${args.amount} ${args.fromCurrency}`,
  ];
  if (args.feeAmount && args.feeAmount > 0) lines.push(`Fee: ${args.feeAmount} ${args.fromCurrency}`);
  if (args.convertedAmount != null && args.toCurrency) {
    lines.push(`Destination receives ≈ ${args.convertedAmount} ${args.toCurrency}`);
  }
  if (args.note) lines.push(`Note: ${args.note}`);
  return {
    title: 'Confirm transfer?',
    message: 'Post this transfer between accounts? Balances will update immediately.',
    confirmLabel: 'Transfer now',
    details: lines,
  };
}

export function summarizeRecurringForConfirm(r: {
  description: string;
  amount: number;
  type: string;
  dayOfMonth: number;
  accountName?: string;
  isEdit?: boolean;
}): ConfirmActionPayload {
  return {
    title: r.isEdit ? 'Save recurring rule?' : 'Add recurring rule?',
    message: r.isEdit
      ? 'Update this recurring transaction rule?'
      : 'Create this recurring transaction rule?',
    confirmLabel: r.isEdit ? 'Save' : 'Add',
    details: [
      r.description,
      `${r.type} · ${r.amount}`,
      `Day ${r.dayOfMonth} of each month`,
      r.accountName ? `Account: ${r.accountName}` : '',
    ].filter(Boolean),
  };
}

export function summarizeStatementImportForConfirm(args: {
  bankCount: number;
  investmentCount: number;
  skippedDuplicates?: number;
  skippedValidation?: number;
}): ConfirmActionPayload {
  const total = args.bankCount + args.investmentCount;
  return {
    title: 'Import selected rows?',
    message:
      total === 0
        ? 'No valid rows to import. Fix validation errors or deselect duplicates.'
        : `Book ${total} row(s) to your ledger? Duplicates and invalid rows are skipped.`,
    confirmLabel: total > 0 ? `Import ${total}` : 'Import',
    details: [
      args.bankCount > 0 ? `${args.bankCount} bank transaction(s)` : '',
      args.investmentCount > 0 ? `${args.investmentCount} investment row(s)` : '',
      (args.skippedDuplicates ?? 0) > 0 ? `${args.skippedDuplicates} duplicate(s) skipped` : '',
      (args.skippedValidation ?? 0) > 0 ? `${args.skippedValidation} invalid row(s) skipped` : '',
    ].filter(Boolean),
  };
}

export function summarizeFinnhubDividendSyncForConfirm(eligibleCount: number): ConfirmActionPayload {
  return {
    title: 'Run Finnhub dividend sync?',
    message:
      'Fetch reported dividends and book new rows on your platform ledgers? Existing dividends are skipped.',
    confirmLabel: 'Run sync',
    details: [`Eligible holdings: ${eligibleCount}`],
  };
}

export function summarizeCommodityForConfirm(h: {
  name: string;
  quantity: number;
  unit: string;
  purchaseValue: number;
  isEdit?: boolean;
}): ConfirmActionPayload {
  return {
    title: h.isEdit ? 'Save commodity holding?' : 'Add commodity holding?',
    message: h.isEdit ? 'Update this commodity in your wealth summary?' : 'Add this commodity to your wealth summary?',
    confirmLabel: h.isEdit ? 'Save' : 'Add',
    details: [`${h.name} · ${h.quantity} ${h.unit}`, `Purchase value: ${h.purchaseValue} SAR`],
  };
}

export function summarizeBudgetForConfirm(b: {
  category: string;
  limit: number;
  month: number;
  year: number;
  isEdit?: boolean;
}): ConfirmActionPayload {
  return {
    title: b.isEdit ? 'Save budget?' : 'Add budget?',
    message: b.isEdit ? 'Update this budget category limit?' : 'Add this budget category for the month?',
    confirmLabel: b.isEdit ? 'Save' : 'Add',
    details: [`${b.category} · ${b.limit}`, `Period: ${b.year}-${String(b.month).padStart(2, '0')}`],
  };
}

export function summarizeLiabilityForConfirm(l: {
  name: string;
  type: string;
  amount: number;
  isEdit?: boolean;
}): ConfirmActionPayload {
  return {
    title: l.isEdit ? 'Save liability?' : 'Add liability?',
    message: l.isEdit ? 'Update this liability on your balance sheet?' : 'Add this liability to your balance sheet?',
    confirmLabel: l.isEdit ? 'Save' : 'Add',
    details: [`${l.name} (${l.type})`, `Amount: ${l.amount}`],
  };
}

export function summarizeZakatPaymentForConfirm(p: { amount: number; date: string; notes?: string }): ConfirmActionPayload {
  return {
    title: 'Record Zakat payment?',
    message: 'Save this Zakat payment to your history?',
    confirmLabel: 'Record payment',
    details: [`Amount: ${p.amount}`, `Date: ${p.date}`, p.notes ? `Notes: ${p.notes}` : ''].filter(Boolean),
  };
}

export function summarizeApplyRecurringForConfirm(monthLabel: string, ruleCount: number): ConfirmActionPayload {
  return {
    title: 'Apply recurring rules?',
    message: `Create transactions from enabled recurring rules for ${monthLabel}?`,
    confirmLabel: 'Apply all',
    details: [`Up to ${ruleCount} active rule(s)`],
  };
}

export function summarizeGoalForConfirm(g: {
  name: string;
  targetAmount: number;
  deadline: string;
  isEdit?: boolean;
}): ConfirmActionPayload {
  return {
    title: g.isEdit ? 'Save goal?' : 'Add goal?',
    message: g.isEdit ? 'Update this savings goal?' : 'Add this savings goal?',
    confirmLabel: g.isEdit ? 'Save' : 'Add',
    details: [`${g.name}`, `Target: ${g.targetAmount}`, `Deadline: ${g.deadline}`],
  };
}

export function summarizeAccountForConfirm(a: {
  name: string;
  type: string;
  balance?: number;
  isEdit?: boolean;
}): ConfirmActionPayload {
  return {
    title: a.isEdit ? 'Save account?' : 'Add account?',
    message: a.isEdit ? 'Update this account?' : 'Add this account to your books?',
    confirmLabel: a.isEdit ? 'Save' : 'Add',
    details: [
      `${a.name} (${a.type})`,
      a.balance != null && a.type !== 'Investment' ? `Balance: ${a.balance}` : '',
    ].filter(Boolean),
  };
}

export function summarizePlatformForConfirm(p: { name: string; isEdit?: boolean }): ConfirmActionPayload {
  return {
    title: p.isEdit ? 'Save platform?' : 'Add investment platform?',
    message: p.isEdit ? 'Update this investment platform?' : 'Add this investment platform account?',
    confirmLabel: p.isEdit ? 'Save' : 'Add',
    details: [p.name],
  };
}

export function summarizePortfolioForConfirm(p: { name: string; currency?: string; isEdit?: boolean }): ConfirmActionPayload {
  return {
    title: p.isEdit ? 'Save portfolio?' : 'Add portfolio?',
    message: p.isEdit ? 'Update this portfolio?' : 'Add this portfolio bucket?',
    confirmLabel: p.isEdit ? 'Save' : 'Add',
    details: [p.name, p.currency ? `Currency: ${p.currency}` : ''].filter(Boolean),
  };
}

export function summarizeHoldingEditForConfirm(h: { symbol: string; name?: string }): ConfirmActionPayload {
  return {
    title: 'Save holding details?',
    message: 'Update this holding metadata and market value on your portfolio?',
    confirmLabel: 'Save',
    details: [h.symbol, h.name ?? ''].filter(Boolean),
  };
}

export function summarizeWatchlistForConfirm(w: { symbol: string; name?: string }): ConfirmActionPayload {
  return {
    title: 'Add to watchlist?',
    message: 'Add this symbol to your watchlist?',
    confirmLabel: 'Add',
    details: [`${w.symbol}${w.name ? ` · ${w.name}` : ''}`],
  };
}

export function summarizePriceAlertForConfirm(a: {
  symbol: string;
  targetPrice: number;
  currency: string;
}): ConfirmActionPayload {
  return {
    title: 'Add price alert?',
    message: 'Create this price alert?',
    confirmLabel: 'Add alert',
    details: [`${a.symbol}`, `Target: ${a.targetPrice} ${a.currency}`],
  };
}

export function summarizeInstallmentPaymentForConfirm(p: {
  description: string;
  amount: number;
  date: string;
  accountName?: string;
}): ConfirmActionPayload {
  return {
    title: 'Record installment payment?',
    message: 'Post this installment as an expense transaction?',
    confirmLabel: 'Record payment',
    details: [
      p.description,
      `Amount: ${p.amount}`,
      `Date: ${p.date}`,
      p.accountName ? `Account: ${p.accountName}` : '',
    ].filter(Boolean),
  };
}

export function summarizeUpdateTransactionForConfirm(tx: Transaction, accountName?: string): ConfirmActionPayload {
  return summarizeTransactionForConfirm(tx, accountName);
}

export function summarizeInvestmentTradeForConfirm(
  trade: Partial<InvestmentTransaction> & { total?: number; currency?: string },
  extras?: { portfolioName?: string; accountName?: string },
): ConfirmActionPayload {
  const type = String(trade.type ?? 'buy');
  return {
    title: confirmTitleForInvestmentType(type),
    message:
      type === 'dividend'
        ? 'Book this dividend cash to your investment platform ledger?'
        : 'Record this trade on your investment platform ledger?',
    details: confirmDetailsForInvestmentTrade({
      type,
      symbol: trade.symbol,
      date: trade.date,
      total: trade.total,
      quantity: trade.quantity,
      price: trade.price,
      currency: trade.currency,
      portfolioName: extras?.portfolioName,
      accountName: extras?.accountName,
    }),
  };
}
