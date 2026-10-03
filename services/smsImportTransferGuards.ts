/**
 * Shared guards for SMS rows that must import as internal transfers (never budgeted expenses).
 */
import type { Transaction } from '../types';
import { isSmsAtmWithdrawalTx, shouldImportSmsAtmAsTransfer } from './smsAtmCashTransfer';
import {
  isSmsCcPaymentTx,
  shouldImportSmsCcPaymentAsTransfer,
} from './smsCcPaymentTransfer';
import { isInternalTransferTransaction } from './transactionFilters';

/** ATM withdrawal or card سداد settlement — never spending, never budget. */
export function isSmsLedgerTransferTx(
  tx: Pick<Transaction, 'note' | 'description' | 'category' | 'amount'>,
): boolean {
  if (isSmsAtmWithdrawalTx(tx) && Number(tx.amount) < 0) return true;
  if (isSmsCcPaymentTx(tx)) return true;
  return false;
}

/** Skip budget mapping / budget UI for SMS transfers and already-labeled Transfer rows. */
export function shouldSkipBudgetForImportedTx(
  tx: Pick<Transaction, 'note' | 'description' | 'category' | 'amount' | 'type'>,
): boolean {
  if (isSmsLedgerTransferTx(tx)) return true;
  if (isInternalTransferTransaction(tx)) return true;
  return false;
}

/** Ready to write via addTransfer (counterparties present). */
export function shouldImportSmsRowAsTransfer(
  tx: Pick<Transaction, 'note' | 'description' | 'category' | 'amount' | 'accountId'>,
): boolean {
  return shouldImportSmsAtmAsTransfer(tx) || shouldImportSmsCcPaymentAsTransfer(tx);
}
