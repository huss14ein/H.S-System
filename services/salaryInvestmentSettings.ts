import type { SalaryInvestmentTargets } from '../types';
import { roundMoney } from '../utils/money';

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_TARGET_ENTRIES = 24;
const MAX_CATEGORY_ENTRIES = 16;
const MAX_KEY_LENGTH = 120;
const MAX_CATEGORY_LENGTH = 80;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function isSafeKey(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_KEY_LENGTH && !DANGEROUS_KEYS.has(trimmed);
}

function clampTargetAmount(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return roundMoney(Math.min(1_000_000_000, n));
}

function clampInvestLagAlertDays(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(1, Math.min(28, Math.round(n)));
}

function sanitizeTargetMap(raw: unknown): Record<string, number> | undefined {
  if (!isPlainObject(raw)) return undefined;
  const entries: [string, number][] = [];
  for (const [key, value] of Object.entries(raw)) {
    const cleanKey = String(key ?? '').trim().slice(0, MAX_KEY_LENGTH);
    if (!isSafeKey(cleanKey)) continue;
    const amount = clampTargetAmount(value);
    if (amount == null) continue;
    entries.push([cleanKey, amount]);
    if (entries.length >= MAX_TARGET_ENTRIES) break;
  }
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function sanitizeCategoryList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    const normalized = String(value ?? '').trim().slice(0, MAX_CATEGORY_LENGTH);
    if (!normalized || normalized.length < 2 || DANGEROUS_KEYS.has(normalized.toLowerCase())) continue;
    const dedupeKey = normalized.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(normalized);
    if (out.length >= MAX_CATEGORY_ENTRIES) break;
  }
  return out.length ? out : undefined;
}

function sanitizeAccountId(value: unknown): string | undefined {
  const normalized = String(value ?? '').trim().slice(0, 128);
  if (!normalized || DANGEROUS_KEYS.has(normalized)) return undefined;
  return normalized;
}

export function normalizeSalaryInvestmentTargets(raw: unknown): SalaryInvestmentTargets | undefined {
  if (!isPlainObject(raw)) return undefined;
  const normalized: SalaryInvestmentTargets = {
    monthlyInvestTargetSar: clampTargetAmount(raw.monthlyInvestTargetSar ?? raw.monthly_invest_target_sar),
    platformTargets: sanitizeTargetMap(raw.platformTargets ?? raw.platform_targets),
    assetClassTargets: sanitizeTargetMap(raw.assetClassTargets ?? raw.asset_class_targets),
    salaryIncomeCategories: sanitizeCategoryList(raw.salaryIncomeCategories ?? raw.salary_income_categories),
    salarySourceAccountId: sanitizeAccountId(raw.salarySourceAccountId ?? raw.salary_source_account_id),
    defaultFundingAccountId: sanitizeAccountId(raw.defaultFundingAccountId ?? raw.default_funding_account_id),
    investLagAlertDays: clampInvestLagAlertDays(raw.investLagAlertDays ?? raw.invest_lag_alert_days),
    includeBonusInSalaryIncome: raw.includeBonusInSalaryIncome === true || raw.include_bonus_in_salary_income === true,
  };
  const hasValue = Object.values(normalized).some((value) => {
    if (Array.isArray(value)) return value.length > 0;
    if (isPlainObject(value)) return Object.keys(value).length > 0;
    return value != null && value !== false;
  });
  return hasValue ? normalized : undefined;
}

export function salaryInvestmentTargetsToRow(
  value: SalaryInvestmentTargets | null | undefined,
): Record<string, unknown> | null {
  const normalized = normalizeSalaryInvestmentTargets(value);
  if (!normalized) return null;
  return {
    ...(normalized.monthlyInvestTargetSar != null ? { monthlyInvestTargetSar: normalized.monthlyInvestTargetSar } : {}),
    ...(normalized.platformTargets ? { platformTargets: normalized.platformTargets } : {}),
    ...(normalized.assetClassTargets ? { assetClassTargets: normalized.assetClassTargets } : {}),
    ...(normalized.salaryIncomeCategories ? { salaryIncomeCategories: normalized.salaryIncomeCategories } : {}),
    ...(normalized.salarySourceAccountId ? { salarySourceAccountId: normalized.salarySourceAccountId } : {}),
    ...(normalized.defaultFundingAccountId ? { defaultFundingAccountId: normalized.defaultFundingAccountId } : {}),
    ...(normalized.investLagAlertDays != null ? { investLagAlertDays: normalized.investLagAlertDays } : {}),
    ...(normalized.includeBonusInSalaryIncome ? { includeBonusInSalaryIncome: true } : {}),
  };
}

export function salaryInvestmentTargetsEqual(
  a: SalaryInvestmentTargets | null | undefined,
  b: SalaryInvestmentTargets | null | undefined,
): boolean {
  return JSON.stringify(salaryInvestmentTargetsToRow(a)) === JSON.stringify(salaryInvestmentTargetsToRow(b));
}
