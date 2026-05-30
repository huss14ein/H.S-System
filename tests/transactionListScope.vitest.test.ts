import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPersonalAccounts, getPersonalTransactions, getScopedCashTransactions } from '../utils/wealthScope';
import {
    filterTransactionsForLedgerView,
    filterTransactionsForLedgerExport,
    parseFilterByBudgetPageAction,
} from '../utils/transactionLedgerFilters';
import type { FinancialData, Transaction } from '../types';

describe('transaction list scope', () => {
    it('Transactions page uses ledger view filter helper with admin/collaborator visibility scope', () => {
        const src = readFileSync(join(process.cwd(), 'pages/Transactions.tsx'), 'utf8');
        expect(src).toContain('filterTransactionsForLedgerView');
        expect(src).toContain('ledgerVisibilityScope');
        expect(src).not.toContain('isPermitted = userRole');
    });

    it('getPersonalTransactions falls back when personal slice is empty', () => {
        const data = {
            accounts: [{ id: 'a1', name: 'Checking', type: 'Checking', balance: 0 }],
            transactions: [{ id: 't1', accountId: 'a1', amount: -10, date: '2026-05-01', description: 'Test', type: 'expense', category: 'Food' }],
            personalTransactions: [],
        } as unknown as FinancialData;
        expect(getPersonalTransactions(data)).toHaveLength(1);
    });

    it('getScopedCashTransactions filters ledger rows to allowed account ids', () => {
        const data = {
            accounts: [
                { id: 'a1', name: 'Mine', type: 'Checking', balance: 0 },
                { id: 'a2', name: 'Other', type: 'Checking', balance: 0, owner: 'Father' },
            ],
            transactions: [
                { id: 't1', accountId: 'a1', amount: -1, date: '2026-05-01', description: 'A', type: 'expense', category: 'x' },
                { id: 't2', accountId: 'a2', amount: -2, date: '2026-05-02', description: 'B', type: 'expense', category: 'x' },
            ] as Transaction[],
            personalTransactions: [{ id: 't1', accountId: 'a1', amount: -1, date: '2026-05-01', description: 'A', type: 'expense', category: 'x' }],
        } as unknown as FinancialData;
        const scoped = getScopedCashTransactions(data, ['a1', 'a2']);
        expect(scoped.map((t) => t.id).sort()).toEqual(['t1', 't2']);
        expect(getScopedCashTransactions(data, ['a2']).map((t) => t.id)).toEqual(['t2']);
    });

    it('getPersonalAccounts falls back when personal slice is empty', () => {
        const data = {
            accounts: [{ id: 'a1', name: 'Checking', type: 'Checking', balance: 0 }],
            personalAccounts: [],
        } as unknown as FinancialData;
        expect(getPersonalAccounts(data)).toHaveLength(1);
    });

    it('key pages use wealthScope helpers instead of personalTransactions ??', () => {
        const pages = [
            'pages/Dashboard.tsx',
            'pages/Budgets.tsx',
            'pages/Forecast.tsx',
            'pages/Investments.tsx',
            'pages/Accounts.tsx',
        ];
        for (const rel of pages) {
            const src = readFileSync(join(process.cwd(), rel), 'utf8');
            expect(src, rel).toContain('getPersonalTransactions');
            expect(src, rel).not.toMatch(/personalTransactions\s*\?\?\s*data\?\.transactions/);
        }
    });

    it('getScopedCashTransactions resolves account_id snake_case', () => {
        const data = {
            accounts: [{ id: 'a1', name: 'Checking', type: 'Checking', balance: 0 }],
            transactions: [
                { id: 't1', account_id: 'a1', amount: 10, date: '2026-05-01', description: 'Pay', type: 'income', category: 'Salary' },
            ],
        } as unknown as FinancialData;
        expect(getScopedCashTransactions(data, ['a1'])).toHaveLength(1);
    });

    it('owner scope shows all scoped rows; collaborator scope filters by permitted categories', () => {
        const txs = [
            { id: 't1', accountId: 'a1', amount: -50, date: '2026-05-10', description: 'Groceries', type: 'expense', category: 'Food', budgetCategory: 'Food' },
            { id: 't2', accountId: 'a1', amount: -20, date: '2026-05-11', description: 'Private', type: 'expense', category: 'Personal', budgetCategory: 'Personal' },
            { id: 't3', accountId: 'a1', amount: 1000, date: '2026-05-01', description: 'Salary', type: 'income', category: 'Salary' },
        ] as Transaction[];
        const filters = {
            accountId: 'all',
            month: '2026-05',
            allMonths: true,
            nature: 'all' as const,
            expenseType: 'all' as const,
            budgetCategory: 'all' as const,
        };
        expect(
            filterTransactionsForLedgerView(txs, filters, 28, {
                mode: 'owner',
                governanceReady: true,
            }),
        ).toHaveLength(3);
        expect(
            filterTransactionsForLedgerView(txs, filters, 28, {
                mode: 'collaborator',
                allowedBudgetCategories: ['Food'],
                governanceReady: true,
            }),
        ).toEqual([txs[0], txs[2]]);
    });

    it('filterTransactionsForLedgerView uses calendar month not fiscal month (day 28 start)', () => {
        const txs = [
            { id: 'early', accountId: 'a1', amount: -10, date: '2026-05-05', description: 'Early May', type: 'expense', category: 'Food' },
            { id: 'late', accountId: 'a1', amount: -10, date: '2026-05-29', description: 'Late May', type: 'expense', category: 'Food' },
            { id: 'june', accountId: 'a1', amount: -10, date: '2026-06-02', description: 'June', type: 'expense', category: 'Food' },
        ] as Transaction[];
        const may = filterTransactionsForLedgerView(
            txs,
            { accountId: 'all', month: '2026-05', allMonths: false, nature: 'all', expenseType: 'all', budgetCategory: 'all' },
            28,
            { mode: 'owner', governanceReady: true },
        );
        expect(may.map((t) => t.id).sort()).toEqual(['early', 'late']);
    });

    it('budget category filter matches split expense lines', () => {
        const txs = [
            {
                id: 'split',
                accountId: 'a1',
                amount: -100,
                date: '2026-05-10',
                description: 'Split shop',
                type: 'expense',
                budgetCategory: 'Food',
                splitLines: [
                    { category: 'Food', amount: 40 },
                    { category: 'Transport', amount: 60 },
                ],
            },
        ] as Transaction[];
        const foodOnly = filterTransactionsForLedgerView(
            txs,
            { accountId: 'all', month: '2026-05', allMonths: true, nature: 'all', expenseType: 'all', budgetCategory: 'Food' },
            1,
            { mode: 'owner', governanceReady: true },
        );
        const transportOnly = filterTransactionsForLedgerView(
            txs,
            { accountId: 'all', month: '2026-05', allMonths: true, nature: 'all', expenseType: 'all', budgetCategory: 'Transport' },
            1,
            { mode: 'owner', governanceReady: true },
        );
        expect(foodOnly).toHaveLength(1);
        expect(transportOnly).toHaveLength(1);
    });

    it('parseFilterByBudgetPageAction decodes encoded category names', () => {
        expect(parseFilterByBudgetPageAction('filter-by-budget:Food%20%26%20Dining:monthly:2026:5')).toEqual({
            category: 'Food & Dining',
            period: 'monthly',
            year: 2026,
            month: 5,
        });
    });

    it('filterTransactionsForLedgerExport respects collaborator visibility and budget filter', () => {
        const txs = [
            { id: 't1', accountId: 'a1', amount: -50, date: '2026-05-10', description: 'Groceries', type: 'expense', budgetCategory: 'Food' },
            { id: 't2', accountId: 'a1', amount: -20, date: '2026-05-12', description: 'Private', type: 'expense', budgetCategory: 'Personal' },
        ] as Transaction[];
        const out = filterTransactionsForLedgerExport(
            txs,
            { accountId: 'all', month: '2026-05', allMonths: false, nature: 'all', expenseType: 'all', budgetCategory: 'Food' },
            {
                dateFrom: new Date(2026, 4, 1),
                dateTo: new Date(2026, 4, 31, 23, 59, 59, 999),
                accountId: 'all',
                visibilityScope: { mode: 'collaborator', allowedBudgetCategories: ['Food'], governanceReady: true },
            },
            1,
        );
        expect(out.map((t) => t.id)).toEqual(['t1']);
    });
});
