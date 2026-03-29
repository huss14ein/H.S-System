import type { InvestmentTransaction } from '../types';

export const normalizeInvestmentTransactionType = (type: unknown): string =>
  String(type ?? '').trim().toLowerCase();

export const isInvestmentTransactionType = (
  type: unknown,
  expected: InvestmentTransaction['type'],
): boolean => normalizeInvestmentTransactionType(type) === expected;
