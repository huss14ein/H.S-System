/**
 * Shared categorization for bank/SMS/statement imports — hybrid rules + budget mapping + user history.
 */
import { classifyTransaction } from './hybridBudgetCategorization';
import { resolveBudgetCategoryForImportedExpense } from './budgetCategoryResolve';
import type { Transaction } from '../types';

function normalizeMerchantKey(v: string): string {
  return String(v || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Infer transaction category from description (and optional amount/type). */
export function inferImportTransactionCategory(
  description: string,
  opts?: { amount?: number; type?: Transaction['type']; userHistory?: Transaction[] },
): string {
  const descRaw = String(description || '');

  if (
    /(شراء عبر نقاط البيع|نقاط البيع|لدى:|payment at|pos purchase|pos debit|purchase at)/i.test(descRaw) &&
    !/(atm|سحب نقدي|cash withdrawal)/i.test(descRaw)
  ) {
    return 'Shopping';
  }
  if (/(شراء إنترنت|online purchase|e-?commerce|noon|amazon|نون|امازون)/i.test(descRaw)) {
    return 'Shopping';
  }
  if (/(atm|سحب نقدي|cash withdrawal)/i.test(descRaw)) {
    return 'Uncategorized';
  }
  if (/(salary|payroll|راتب|ايداع|إيداع|transfer received|income transfer)/i.test(descRaw)) {
    return 'Income';
  }

  const amount =
    typeof opts?.amount === 'number' && Number.isFinite(opts.amount)
      ? opts.amount
      : opts?.type === 'income'
        ? 100
        : -100;
  const type = opts?.type ?? (amount < 0 ? 'expense' : 'income');
  const tx = {
    description,
    amount,
    type,
    category: '',
  } as Transaction;
  const classified = classifyTransaction(tx, false, opts?.userHistory);
  if (classified.category && classified.category !== 'Uncategorized') {
    return classified.category;
  }
  return type === 'income' ? 'Income' : 'Uncategorized';
}

/** Map parser row → { category, budgetCategory } using budgets + prior user labels. */
export function categorizeImportedTransaction(
  tx: Pick<Transaction, 'type' | 'description' | 'amount' | 'category' | 'budgetCategory'>,
  opts?: {
    budgetCategoryNames?: string[];
    userHistory?: Transaction[];
  },
): { category: string; budgetCategory?: string } {
  const history = opts?.userHistory ?? [];
  const descKey = normalizeMerchantKey(tx.description || '');
  const historyMatch = history.find((h) => {
    if (h.type !== tx.type) return false;
    const hKey = normalizeMerchantKey(h.description || '');
    if (!hKey || !descKey) return false;
    return hKey === descKey || hKey.includes(descKey) || descKey.includes(hKey);
  });

  let category = String(tx.category || '').trim();
  if (!category || category === 'Uncategorized') {
    category = inferImportTransactionCategory(String(tx.description || ''), {
      amount: tx.amount,
      type: tx.type,
      userHistory: history,
    });
  } else {
    const refined = inferImportTransactionCategory(`${category} ${tx.description || ''}`, {
      amount: tx.amount,
      type: tx.type,
      userHistory: history,
    });
    if (refined !== 'Uncategorized') category = refined;
  }

  if (historyMatch?.category && historyMatch.category !== 'Uncategorized') {
    category = historyMatch.category;
  }
  if (historyMatch?.budgetCategory && tx.type === 'expense') {
    return { category, budgetCategory: historyMatch.budgetCategory };
  }

  const budgetNames = opts?.budgetCategoryNames ?? [];
  const budgetCategory =
    tx.type === 'expense'
      ? resolveBudgetCategoryForImportedExpense({ ...tx, category }, budgetNames)
      : undefined;

  return { category, budgetCategory };
}
