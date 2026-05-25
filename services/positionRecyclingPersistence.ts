/**
 * Client-side persistence for position recycling prefs and execution history.
 */

import type { PositionRecyclingPlan } from './positionRecyclingPlan';
import type { ConvictionGrade, StockQualityStatus } from './positionRecyclingPlan';

export interface PositionRecyclingSymbolPrefs {
  convictionGrade?: ConvictionGrade;
  stockQualityStatus?: StockQualityStatus;
  minRebuyDiscountPercent?: number;
  avoidSellingBelowAverage?: boolean;
  allowSellNearLoss?: boolean;
  updatedAt: number;
}

export interface PositionRecyclingExecution {
  id: string;
  symbol: string;
  timestamp: number;
  planStatus: PositionRecyclingPlan['planStatus'];
  planAvailable: boolean;
  coreShares?: number;
  maxRecycleShares?: number;
  trancheCount: number;
  finalBreakEven?: number;
  breakEvenImprovement?: number;
  actionMessage: string;
  executionStatus: 'planned' | 'partial' | 'complete' | 'cancelled';
}

const PREFS_KEY = 'position-recycling-prefs:v1';
const EXEC_KEY = 'position-recycling-executions:v1';
const MAX_EXEC = 300;

/** In-memory fallback when localStorage is unavailable (tests / SSR). */
const memPrefs = new Map<string, PositionRecyclingSymbolPrefs>();
const memExecutions: PositionRecyclingExecution[] = [];

function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage?.getItem === 'function';
  } catch {
    return false;
  }
}

export function loadRecyclingPrefs(symbol: string): PositionRecyclingSymbolPrefs | null {
  if (!symbol) return null;
  const sym = symbol.toUpperCase();
  if (hasLocalStorage()) {
    try {
      const raw = window.localStorage.getItem(PREFS_KEY);
      if (!raw) return memPrefs.get(sym) ?? null;
      const map = JSON.parse(raw) as Record<string, PositionRecyclingSymbolPrefs>;
      return map[sym] ?? memPrefs.get(sym) ?? null;
    } catch {
      return memPrefs.get(sym) ?? null;
    }
  }
  return memPrefs.get(sym) ?? null;
}

export function saveRecyclingPrefs(symbol: string, prefs: Omit<PositionRecyclingSymbolPrefs, 'updatedAt'>): void {
  if (!symbol) return;
  const sym = symbol.toUpperCase();
  const row: PositionRecyclingSymbolPrefs = { ...prefs, updatedAt: Date.now() };
  memPrefs.set(sym, row);
  if (!hasLocalStorage()) return;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    const map: Record<string, PositionRecyclingSymbolPrefs> = raw ? JSON.parse(raw) : {};
    map[sym] = row;
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(map));
  } catch {
    // ignore quota errors
  }
}

export function saveRecyclingExecutionFromPlan(plan: PositionRecyclingPlan): string {
  const id = `recycle-${plan.ticker}-${Date.now()}`;
  const execution: PositionRecyclingExecution = {
    id,
    symbol: plan.ticker,
    timestamp: Date.now(),
    planStatus: plan.planStatus,
    planAvailable: plan.planAvailable,
    coreShares: plan.positionSplit?.coreShares,
    maxRecycleShares: plan.positionSplit?.maxRecycleShares,
    trancheCount: plan.recyclingLadder.length,
    finalBreakEven: plan.projectedOutcome?.finalBreakEvenIfAllTranchesComplete,
    breakEvenImprovement: plan.projectedOutcome?.totalBreakEvenImprovementPerShare,
    actionMessage: plan.actionMessage,
    executionStatus: 'planned',
  };
  saveRecyclingExecution(execution);
  return id;
}

export function saveRecyclingExecution(execution: PositionRecyclingExecution): void {
  const existing = getRecyclingExecutions();
  const updated = [...existing.filter((e) => e.id !== execution.id), execution]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_EXEC);
  memExecutions.length = 0;
  memExecutions.push(...updated);
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(EXEC_KEY, JSON.stringify(updated));
  } catch {
    // ignore
  }
}

export function getRecyclingExecutions(): PositionRecyclingExecution[] {
  if (hasLocalStorage()) {
    try {
      const raw = window.localStorage.getItem(EXEC_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // fall through to memory
    }
  }
  return [...memExecutions];
}

export function getRecyclingExecutionsBySymbol(symbol: string): PositionRecyclingExecution[] {
  const sym = symbol.toUpperCase();
  return getRecyclingExecutions().filter((e) => e.symbol.toUpperCase() === sym);
}

export function exportRecyclingPlanJson(plan: PositionRecyclingPlan): string {
  return JSON.stringify(plan, null, 2);
}

/** @internal Vitest only */
export function __resetRecyclingPersistenceForTests(): void {
  memPrefs.clear();
  memExecutions.length = 0;
}
