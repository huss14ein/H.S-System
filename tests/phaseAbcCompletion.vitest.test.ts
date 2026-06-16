/**
 * End-to-end completion guards for Phases A (Transactions), B (Snapshots), C (Rename).
 * Run after each phase before marking it done — see .cursor/rules/phase-e2e-verification.mdc
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    filterTransactionsForLedgerExport,
    filterTransactionsForLedgerView,
} from '../utils/transactionLedgerFilters';
import type { Transaction } from '../types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('Phase A — Transactions E2E', () => {
    it('pipeline: DataContext → scoped ledger → visibility filter → list', () => {
        expect(read('context/DataContext.tsx')).toContain('transactionsLoadWarning');
        expect(read('context/DataContext.tsx')).toContain('normalizeCashTransactionRow');
        expect(read('context/DataContext.tsx')).toContain('resolveAccountId');
        expect(read('pages/Transactions.tsx')).toContain('getScopedCashTransactions');
        expect(read('pages/Transactions.tsx')).toContain('filterTransactionsForLedgerView');
        expect(read('pages/Transactions.tsx')).toContain('ledgerVisibilityScope');
    });

    it('budget drill-down uses fiscal month and scrolls to list', () => {
        expect(read('pages/Transactions.tsx')).toContain("monthMode: 'fiscal'");
        expect(read('pages/Budgets.tsx')).toContain('filter-by-budget:');
        expect(read('pages/Budgets.tsx')).toContain('budget.period');
        expect(read('pages/Transactions.tsx')).toContain('transactionListRef');
        expect(read('pages/Transactions.tsx')).toContain('scrollIntoView');
    });

    it('admin scope uses full accounts; collaborators gate on governanceReady', () => {
        const tx = read('pages/Transactions.tsx');
        expect(tx).toMatch(/userRole === 'Admin'[\s\S]*data\?\.accounts/);
        expect(tx).toContain('governanceReady');
        expect(read('pages/Transactions.tsx')).toContain('scheduleIdleWork');
        expect(tx).toMatch(/budgetCategory !== 'all'/);
        expect(tx).toContain('Loading permissions');
        expect(tx).toContain('orphanTransactionCount');
    });

    it('export uses same visibility scope as the list', () => {
        const txs = [
            { id: 't1', accountId: 'a1', amount: -50, date: '2026-05-10', type: 'expense', budgetCategory: 'Food' },
            { id: 't2', accountId: 'a1', amount: -20, date: '2026-05-12', type: 'expense', budgetCategory: 'Personal' },
        ] as Transaction[];
        const scope = { mode: 'collaborator' as const, allowedBudgetCategories: ['Food'], governanceReady: true };
        const list = filterTransactionsForLedgerView(
            txs,
            { accountId: 'all', month: '2026-05', allMonths: false, nature: 'all', expenseType: 'all', budgetCategory: 'all' },
            1,
            scope,
        );
        const exported = filterTransactionsForLedgerExport(
            txs,
            { accountId: 'all', month: '2026-05', allMonths: false, nature: 'all', expenseType: 'all', budgetCategory: 'all' },
            {
                dateFrom: new Date(2026, 4, 1),
                dateTo: new Date(2026, 4, 31, 23, 59, 59, 999),
                accountId: 'all',
                visibilityScope: scope,
            },
            1,
        );
        expect(exported.map((t) => t.id)).toEqual(list.map((t) => t.id));
    });
});

describe('Phase B — Snapshot readiness E2E', () => {
    it('all auto-capture paths gate on snapshot readiness and canonical headline', () => {
        expect(read('pages/Dashboard.tsx')).toContain('tryAutoCaptureNetWorthSnapshot');
        expect(read('pages/Summary.tsx')).toContain('tryAutoCaptureNetWorthSnapshot');
        expect(read('components/Layout.tsx')).toContain('canAutoCaptureNetWorthSnapshot');
        expect(read('services/netWorthSnapshotReadiness.ts')).toContain('metricsExtendedReady');
        expect(read('services/netWorthSnapshotCapture.ts')).toContain('captureNetWorthSnapshotFromHeadline');
    });

    it('snapshot capture uses canonical headline and quote fingerprint in capture service', () => {
        expect(read('services/netWorthSnapshotCapture.ts')).toContain('quoteRefreshFingerprint');
        expect(read('services/netWorthSnapshotCapture.ts')).toContain('captureNetWorthSnapshotFromHeadline');
        expect(read('services/netWorthSnapshotThrottle.ts')).toContain('SESSION_QUOTE_FP_PREFIX');
    });

    it('scheduled monthly snapshot respects readiness when provided', () => {
        expect(read('services/scheduledNetWorthSnapshot.ts')).toContain('snapshotReadiness');
        expect(read('services/scheduledNetWorthSnapshot.ts')).toContain('canAutoCaptureNetWorthSnapshot');
    });
});

describe('Phase C — Rename E2E', () => {
    it('display name is Wealth Analytics only (no charts & health subtitle)', () => {
        expect(read('constants.tsx')).toMatch(/'Wealth Analytics':\s*'Wealth Analytics'/);
        expect(read('constants.tsx')).not.toContain('charts & health');
        expect(read('pages/Summary.tsx')).not.toContain('charts & health');
    });

    it('nav and document title use PAGE_DISPLAY_NAMES', () => {
        expect(read('components/AuthenticatedAppShell.tsx')).toContain('PAGE_DISPLAY_NAMES[activePage]');
        expect(read('components/Header.tsx')).toContain('PAGE_DISPLAY_NAMES');
    });
});
