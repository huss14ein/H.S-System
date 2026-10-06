/**
 * E2E wiring: Statement Upload SMS + categorize → import, and realized P/L system surfaces.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { categorizeImportedTransaction } from '../services/importTransactionCategorization';
import { planStatementImport, type StatementImportContext } from '../services/statementImportPrepare';
import { resolveDuplicateHoldingsGroup } from '../services/holdingsDedupe';
import type { Holding, Transaction } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('statementUploadImportCompletion', () => {
  it('Statement Upload wires SMS parse → categorize → addTransaction category+budgetCategory', () => {
    const stmt = read('pages/StatementUpload.tsx');
    expect(stmt).toContain('parseSMSTransactions');
    expect(stmt).toContain('enrichTransactionsWithBudgetMapping');
    expect(stmt).toContain('categorizeImportedTransaction');
    expect(stmt).toContain('budgetCategory: tx.budgetCategory');
    expect(stmt).toContain('category: tx.category');
    expect(stmt).toContain('focus-sms-tab');
    expect(stmt).toContain('pageAction');
    expect(stmt).toContain('financialMonthKeyFromTransactionDate');
    expect(stmt).toContain('budgetCategoriesForTransactionDate');
    expect(stmt).toContain('note: tx.note');
    expect(stmt).toContain('selectedMissingAccount');
    expect(stmt).toContain('type="date"');
    // Stale budget links from another month must be cleared when remapping.
    expect(stmt).toContain('budgetCategoryNames.includes(nextBudget)');
    expect(stmt).not.toContain('budgetCategory: mapped.budgetCategory ?? next.budgetCategory');
    expect(stmt).not.toContain('budgetCategory: mapped.budgetCategory ?? tx.budgetCategory');
  });

  it('Statement Upload wires ATM SMS → addTransfer (source debit + cash credit)', () => {
    const stmt = read('pages/StatementUpload.tsx');
    expect(stmt).toContain('addTransfer');
    expect(stmt).toContain('shouldImportSmsAtmAsTransfer');
    expect(stmt).toContain('parseSmsAtmCashToFromNote');
    expect(stmt).toContain('selectedAtmMissingCash');
    expect(stmt).toContain('smsNoteWithAtmMeta');
    expect(stmt).toContain('Cash account…');
    const atm = read('services/smsAtmCashTransfer.ts');
    expect(atm).toContain('applySmsAtmCashTransfers');
    expect(atm).toContain('resolvePhysicalCashAccount');
    expect(atm).toContain('physical_cash');
    const parser = read('services/statementParser.ts');
    expect(parser).toContain('applySmsAtmCashTransfers');
    const accounts = read('pages/Accounts.tsx');
    expect(accounts).toContain('physical_cash');
    expect(accounts).toContain('Physical cash / wallet');
    expect(read('types.ts')).toContain("| 'physical_cash'");
  });

  it('Statement Upload wires حوالة SMS → addTransfer (source → destination) with fee, no budget', () => {
    const stmt = read('pages/StatementUpload.tsx');
    expect(stmt).toContain('shouldImportSmsAccountAsTransfer');
    expect(stmt).toContain('parseSmsAccountTransferToFromNote');
    expect(stmt).toContain('smsAccountTransferPrincipalAmount');
    expect(stmt).toContain('parseSmsTransferFeeFromNote');
    expect(stmt).toContain('smsNoteWithAccountTransferMeta');
    expect(stmt).toContain('Transfer to…');
    expect(stmt).toContain('Local transfer (حوالة)');
    expect(stmt).toContain('shouldImportSmsAccountTransferInAsTransfer');
    expect(stmt).toContain('parseSmsAccountTransferFromFromNote');
    expect(stmt).toContain('smsNoteWithAccountTransferInMeta');
    expect(stmt).toContain('Received from…');
    expect(stmt).toContain('selectedInboundMissingFrom');
    expect(stmt).toContain('Local transfer in (حوالة واردة)');
    const acct = read('services/smsAccountTransfer.ts');
    expect(acct).toContain('applySmsAccountTransfers');
    expect(acct).toContain('applySmsAccountTransferIns');
    expect(acct).toContain('pairSmsAccountTransferLegs');
    expect(acct).toContain("SMS_ACCOUNT_TRANSFER_KIND = 'account_transfer'");
    expect(acct).toContain("SMS_ACCOUNT_TRANSFER_IN_KIND = 'account_transfer_in'");
    expect(acct).toContain('sms:transfer_to');
    expect(acct).toContain('sms:transfer_from');
    expect(acct).toContain('resolveAccountTransferDestination');
    const patterns = read('services/smsBankTransferPatterns.ts');
    expect(patterns).toContain('SMS_ACCOUNT_TRANSFER_OUT_RE');
    expect(patterns).toContain('SMS_ACCOUNT_TRANSFER_IN_RE');
    expect(patterns).toContain('حوالة\\s*(?:محلية|داخلية|فورية)?\\s*صادرة');
    expect(patterns).toContain('extractSmsTransferDestinationLast4');
    const parser = read('services/statementParser.ts');
    expect(parser).toContain('applySmsAccountTransfers');
    expect(parser).toContain('applySmsAccountTransferIns');
    expect(parser).toContain('pairSmsAccountTransferLegs');
    expect(parser).toContain('smsNoteWithAccountTransferMeta');
    expect(parser).toContain('smsNoteWithAccountTransferInMeta');
    expect(parser).toContain('sms:kind=(?:atm|cc_payment|account_transfer(?:_in)?)');
    const prepare = read('services/statementImportPrepare.ts');
    expect(prepare).toContain('isSmsAccountTransferTx');
    expect(prepare).toContain('isSmsAccountTransferInTx');
    expect(prepare).toContain('shouldImportSmsAccountAsTransfer');
    expect(prepare).toContain('Received-from source account');
    expect(prepare).toContain('shouldSkipPairedSmsAccountTransferIn');
    const guards = read('services/smsImportTransferGuards.ts');
    expect(guards).toContain('isSmsAccountTransferTx');
    expect(guards).toContain('isSmsAccountTransferInTx');
    expect(read('tests/smsAccountTransfer.vitest.test.ts')).toContain('حوالة محلية صادرة');
    expect(read('tests/smsAlinmaFullPaste.vitest.test.ts')).toContain('parses all 28 rows');
    expect(read('tests/smsAlinmaPaste.vitest.test.ts')).toContain('لحساب *7000');
    expect(read('tests/smsAlinmaPaste.vitest.test.ts')).toContain('pairs outgoing + incoming');
  });

  it('Statement Upload wires سداد CC payment SMS → addTransfer (funding → card) with no budget', () => {
    const stmt = read('pages/StatementUpload.tsx');
    expect(stmt).toContain('shouldImportSmsCcPaymentAsTransfer');
    expect(stmt).toContain('parseSmsCcFundedFromNote');
    expect(stmt).toContain('selectedCcMissingFunding');
    expect(stmt).toContain('smsNoteWithCcPaymentMeta');
    expect(stmt).toContain('Paid from…');
    expect(stmt).toContain('Not applicable (transfer)');
    expect(stmt).toContain('isSmsLedgerTransferTx');
    expect(stmt).toContain("must import as a transfer from a funding account");
    expect(stmt).toContain("must import as a transfer to Cash");
    const cc = read('services/smsCcPaymentTransfer.ts');
    expect(cc).toContain('applySmsCcPaymentTransfers');
    expect(cc).toContain('resolveCcPaymentFundingAccount');
    expect(cc).toContain('sms:funded_from');
    expect(cc).toContain("SMS_CC_PAYMENT_KIND = 'cc_payment'");
    expect(cc).toContain('smsTextLooksLikeCardSettlement');
    const patterns = read('services/smsBankTransferPatterns.ts');
    expect(patterns).toContain('SMS_ATM_WITHDRAWAL_RE');
    expect(patterns).toContain('SMS_CARD_SETTLEMENT_RE');
    expect(patterns).toContain('credit\\s*card\\s*(?:payment|settlement|paid)');
    expect(patterns).toContain('تم\\s*سداد');
    expect(patterns).toContain('smsLooksLikeCardSettlementCredit');
    expect(read('tests/smsBankTransferPatterns.vitest.test.ts')).toContain('SNB-style English');
    expect(read('tests/smsBankTransferPatterns.vitest.test.ts')).toContain('Alinma-style');
    expect(read('tests/smsBankTransferPatterns.vitest.test.ts')).toContain('SABB/BSF-style');
    const parser = read('services/statementParser.ts');
    expect(parser).toContain('applySmsCcPaymentTransfers');
    expect(parser).toContain('smsNoteWithCcPaymentMeta');
    expect(parser).toContain('smsTextLooksLikeAtmWithdrawal');
    expect(parser).toContain('smsTextLooksLikeCardSettlement');
    const cat = read('services/importTransactionCategorization.ts');
    expect(cat).toContain('isSmsLedgerTransferTx');
    expect(cat).toContain('shouldSkipBudgetForImportedTx');
    expect(cat).toContain('smsTextLooksLikeAtmWithdrawal');
    const prepare = read('services/statementImportPrepare.ts');
    expect(prepare).toContain('isSmsCcPaymentTx');
    expect(prepare).toContain('Paid-from funding account');
    expect(prepare).toContain('ATM withdrawal needs a Cash destination');
    const accounts = read('pages/Accounts.tsx');
    expect(accounts).toContain('Debt servicing');
    expect(accounts).toContain('SMS سداد imports');
  });

  it('SMS parser merchant-aware dedupe + amount-aware categories', () => {
    const parser = read('services/statementParser.ts');
    expect(parser).toContain('smsDedupeDescriptionKey');
    expect(parser).toContain('inferCategoryForSignedAmount');
    expect(parser).toContain('inferImportTransactionCategory');
    expect(parser).toContain('classifySmsIsDebit');
    expect(parser).toContain('إجمالي');
    expect(parser).toContain('المبلغ\\s*المستحق');
    expect(parser).toContain('isSmsTrailingMetaLine');
    expect(parser).toContain('cleanSmsMerchantLabel');
    expect(parser).toContain('pruneSmsSatelliteTransactions');
    expect(parser).toContain('applySmsAccountRouting');
    expect(parser).toContain('mergeSmsTransferMetaFromGroup');
    expect(parser).toContain('sms:kind=(?:atm|cc_payment|account_transfer(?:_in)?)');
    expect(parser).not.toMatch(/const key = `\$\{date\}\|\$\{mag\}`;/);
  });

  it('Statement Upload wires SMS card routing + per-row account + import-anyway', () => {
    const stmt = read('pages/StatementUpload.tsx');
    expect(stmt).toContain('parseSMSTransactions(smsText, fallbackAccountId,');
    expect(stmt).toContain('accounts: data?.accounts');
    expect(stmt).toContain('parseSmsCardLast4FromNote');
    expect(stmt).toContain('requireSameAccount: true');
    expect(stmt).toContain('import anyway');
    expect(stmt).toContain('handleExtractedTransactionEdit(index, { accountId: nextSource })');
    expect(stmt).toContain('Default / fallback account (optional)');
    expect(stmt).toContain('disabled={!smsText.trim() || isProcessingFile}');
    expect(stmt).not.toContain("alert('Please select an account')");
    const accounts = read('pages/Accounts.tsx');
    expect(accounts).toContain('lastFourDigits');
    expect(accounts).toContain('Card / account last 4');
    const routing = read('services/smsImportRouting.ts');
    expect(routing).toContain('extractSmsCardLast4');
    expect(routing).toContain('applySmsAccountRouting');
    expect(routing).toContain('لحساب');
    expect(routing).toContain('مدى\\s*(\\d{4})');
    const prepare = read('services/statementImportPrepare.ts');
    expect(prepare).toContain('missing account (set Card last-4 or assign in review)');
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('isAccountsPlatformDetailsColumnMissing');
    expect(ctx).toContain('20261003170000_accounts_platform_details_card_last4.sql');
    expect(read('supabase/migrations/20261003170000_accounts_platform_details_card_last4.sql')).toContain(
      'platform_details',
    );
    expect(read('docs/DB_CHANGES.md')).toContain('accounts.platform_details');
  });

  it('planStatementImport does not reject expenses missing budgetCategory', () => {
    const ctx: StatementImportContext = {
      accounts: [{ id: 'acc-1', name: 'Checking', type: 'Checking', balance: 0, currency: 'SAR' } as any],
      portfolios: [],
      existingBankTransactions: [],
      existingInvestmentTransactions: [],
      sarPerUsd: 3.75,
      preferredAccountId: 'acc-1',
    };
    const rows: Transaction[] = [
      {
        id: 't1',
        date: '2026-04-08',
        description: 'CAFE NERO',
        amount: -50,
        category: 'Food & Dining',
        accountId: 'acc-1',
        type: 'expense',
        status: 'Approved',
      },
      {
        id: 't2',
        date: '2026-04-08',
        description: 'JARIR BOOK',
        amount: -50,
        category: 'Shopping',
        accountId: 'acc-1',
        type: 'expense',
        status: 'Approved',
      },
    ];
    const plan = planStatementImport({
      bankTransactions: rows,
      investmentTransactions: [],
      selectedIndices: new Set([0, 1]),
      duplicateIndices: new Set(),
      ctx,
    });
    expect(plan.importableBankRows.length).toBe(2);
    expect(plan.skippedValidation).toBe(0);
  });

  it('categorizeImportedTransaction prefers history merchant budget', () => {
    const mapped = categorizeImportedTransaction(
      { type: 'expense', description: 'STARBUCKS RIYADH', amount: -22, category: 'Uncategorized' },
      {
        budgetCategoryNames: ['Food & Dining', 'Shopping'],
        userHistory: [
          {
            id: 'h',
            type: 'expense',
            description: 'STARBUCKS OLAYA',
            amount: -18,
            category: 'Food & Dining',
            budgetCategory: 'Food & Dining',
            accountId: 'a',
            date: '2026-01-01',
            status: 'Approved',
          },
        ],
      },
    );
    expect(mapped.budgetCategory).toBe('Food & Dining');
  });

  it('shell + palette + pageActions route SMS and realized P/L sync', () => {
    expect(read('utils/pageActions.ts')).toContain("page === 'Statement Upload'");
    expect(read('utils/pageActions.ts')).toContain('focus-sms-tab');
    expect(read('utils/pageActions.ts')).toContain('sync-realized-pnl');
    expect(read('components/AuthenticatedAppShell.tsx')).toContain("case 'Statement Upload'");
    expect(read('components/CommandPalette.tsx')).toContain('Paste bank SMS transactions');
    expect(read('components/CommandPalette.tsx')).toContain('Sync realized P/L from ledger');
    expect(read('pages/Investments.tsx')).toContain("pageAction === 'sync-realized-pnl'");
    expect(read('context/DataContext.tsx')).toContain('backfillRealizedPnLForAllPortfolios');
  });

  it('duplicate holdings merge preserves realized PnL carrier', () => {
    const closed: Holding = {
      id: 'h-closed',
      symbol: 'AAPL',
      quantity: 0,
      avgCost: 0,
      currentValue: 0,
      realizedPnL: 250,
      zakahClass: 'Zakatable',
    };
    const ghost: Holding = {
      id: 'h-ghost',
      symbol: 'AAPL',
      quantity: 0,
      avgCost: 0,
      currentValue: 0,
      realizedPnL: 0,
      zakahClass: 'Zakatable',
    };
    const resolved = resolveDuplicateHoldingsGroup({
      holdings: [ghost, closed],
      portfolioId: 'pf1',
      symbol: 'AAPL',
      transactions: [],
    });
    expect(resolved.keep.realizedPnL).toBe(250);
    expect(resolved.deleteIds).toContain('h-ghost');
  });

  it('history reconcile requires description similarity (not date+amount alone)', () => {
    const src = read('context/StatementProcessingContext.tsx');
    expect(src).toContain('dateMatch && amountMatch && descSimilarity');
    expect(src).not.toContain('descSimilarity || amountMatch');
  });
});
