import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPersonalAccounts, getPersonalTransactions, getScopedCashTransactions } from '../utils/wealthScope';
import type { FinancialData, Transaction } from '../types';

describe('transaction list scope', () => {
    it('Transactions page uses getScopedCashTransactions (not empty personalTransactions ??)', () => {
        const src = readFileSync(join(process.cwd(), 'pages/Transactions.tsx'), 'utf8');
        expect(src).toContain('getScopedCashTransactions');
        expect(src).not.toMatch(/personalTransactions\s*\?\?\s*data\?\.transactions/);
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
});
