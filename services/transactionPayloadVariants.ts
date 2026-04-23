import type { Transaction } from '../types';

type TransactionPayloadInput = (Omit<Transaction, 'id' | 'user_id'> | Transaction) & {
  account_id?: string;
  budget_category?: string;
  recurring_id?: string;
  transfer_group_id?: string;
  transfer_role?: string;
  expense_type?: string;
  transaction_nature?: string;
  statement_id?: string;
};

export function buildTransactionPayloadVariants(
  transaction: TransactionPayloadInput,
): Record<string, unknown>[] {
  const { splitLines: _sl, ...txRest } = transaction as Transaction & { splitLines?: unknown };
  const transactionClean = txRest as TransactionPayloadInput;
  const recId = transactionClean.recurringId ?? transactionClean.recurring_id;
  const budgetCat = transactionClean.budgetCategory ?? transactionClean.budget_category;
  const accountId = transactionClean.accountId ?? transactionClean.account_id;
  const transferGroupId = transactionClean.transferGroupId ?? transactionClean.transfer_group_id;
  const transferRole = transactionClean.transferRole ?? transactionClean.transfer_role;

  const base = {
    date: transactionClean.date,
    description: transactionClean.description,
    amount: transactionClean.amount,
    category: transactionClean.category,
    type: transactionClean.type,
    note: transactionClean.note,
    status: transactionClean.status,
    subcategory: transactionClean.subcategory,
    expenseType: transactionClean.expenseType ?? transactionClean.expense_type,
    transactionNature: transactionClean.transactionNature ?? transactionClean.transaction_nature,
    statementId: transactionClean.statementId ?? transactionClean.statement_id,
  } as const;

  const compact = (obj: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    Object.entries(obj).forEach(([k, v]) => {
      if (v !== undefined) out[k] = v;
    });
    return out;
  };

  const payloadWithSnakeCase = compact({
    date: base.date,
    description: base.description,
    amount: base.amount,
    category: base.category,
    type: base.type,
    note: base.note,
    status: base.status,
    subcategory: base.subcategory,
    expense_type: base.expenseType,
    transaction_nature: base.transactionNature,
    statement_id: base.statementId,
    recurring_id: recId,
    budget_category: budgetCat,
    account_id: accountId,
    transfer_group_id: transferGroupId,
    transfer_role: transferRole,
  });

  const payloadWithCamelCase = compact({
    date: base.date,
    description: base.description,
    amount: base.amount,
    category: base.category,
    type: base.type,
    note: base.note,
    status: base.status,
    subcategory: base.subcategory,
    expenseType: base.expenseType,
    transactionNature: base.transactionNature,
    statementId: base.statementId,
    recurringId: recId,
    budgetCategory: budgetCat,
    accountId: accountId,
    transferGroupId: transferGroupId,
    transferRole: transferRole,
  });

  const payloadWithSnakeCaseCore = compact({
    date: base.date,
    description: base.description,
    amount: base.amount,
    category: base.category,
    type: base.type,
    status: base.status,
    account_id: accountId,
    budget_category: budgetCat,
  });

  const payloadWithCamelCaseCore = compact({
    date: base.date,
    description: base.description,
    amount: base.amount,
    category: base.category,
    type: base.type,
    status: base.status,
    accountId: accountId,
    budgetCategory: budgetCat,
  });

  const variants: Record<string, unknown>[] = [payloadWithSnakeCase, payloadWithCamelCase];
  const hasNote = transactionClean.note != null && String(transactionClean.note).trim() !== '';
  if (hasNote) {
    const { note: _n0, ...snakeNoNote } = { ...payloadWithSnakeCase };
    const { note: _n1, ...camelNoNote } = { ...payloadWithCamelCase };
    // Try full payloads without note before falling back to minimal core payloads,
    // so legacy schemas missing only `note` keep metadata columns intact.
    variants.push(snakeNoNote);
    variants.push(camelNoNote);
  }
  variants.push(payloadWithSnakeCaseCore);
  variants.push(payloadWithCamelCaseCore);
  return variants;
}
