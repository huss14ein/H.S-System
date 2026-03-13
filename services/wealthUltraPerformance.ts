/**
 * Wealth Ultra Performance Tracking Service
 * Tracks historical performance, calculates metrics, and provides analytics
 */

import type { WealthUltraPosition, WealthUltraSleeveAllocation } from '../types';

export interface PerformanceSnapshot {
  timestamp: number;
  totalPortfolioValue: number;
  allocations: WealthUltraSleeveAllocation[];
  positions: Array<{
    symbol: string;
    marketValue: number;
    plPct: number;
    sleeveType: string;
  }>;
  metrics: {
    totalReturn: number;
    totalReturnPct: number;
    sharpeRatio?: number;
    maxDrawdown?: number;
    volatility?: number;
  };
}

export interface PerformanceMetrics {
  totalReturn: number;
  totalReturnPct: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  volatility: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  sleevePerformance: Record<string, {
    return: number;
    returnPct: number;
    contribution: number;
  }>;
}

const STORAGE_KEY = 'wealth-ultra-performance-snapshots:v1';
const MAX_SNAPSHOTS = 365; // Keep 1 year of daily snapshots

export function savePerformanceSnapshot(snapshot: PerformanceSnapshot): void {
  if (typeof window === 'undefined') return;
  try {
    // Validate snapshot data
    if (!snapshot || typeof snapshot.timestamp !== 'number' || !Number.isFinite(snapshot.totalPortfolioValue)) {
      console.warn('Invalid performance snapshot data:', snapshot);
      return;
    }
    
    const existing = getPerformanceSnapshots();
    // Remove duplicates (same timestamp within 1 hour)
    const deduplicated = existing.filter(s => 
      Math.abs(s.timestamp - snapshot.timestamp) > 60 * 60 * 1000
    );
    
    const updated = [snapshot, ...deduplicated]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, MAX_SNAPSHOTS);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (error) {
    console.warn('Failed to save performance snapshot:', error);
  }
}

export function getPerformanceSnapshots(): PerformanceSnapshot[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function calculatePerformanceMetrics(
  snapshots: PerformanceSnapshot[],
  currentValue: number
): PerformanceMetrics | null {
  if (snapshots.length < 2) return null;

  const sorted = [...snapshots].sort((a, b) => a.timestamp - b.timestamp);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  const totalReturn = currentValue - first.totalPortfolioValue;
  const totalReturnPct = first.totalPortfolioValue > 0
    ? (totalReturn / first.totalPortfolioValue) * 100
    : 0;

  // Calculate daily returns
  const dailyReturns: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].totalPortfolioValue;
    const curr = sorted[i].totalPortfolioValue;
    if (prev > 0) {
      dailyReturns.push((curr - prev) / prev);
    }
  }

  if (dailyReturns.length === 0) return null;

  // Volatility (annualized)
  const meanReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / dailyReturns.length;
  const volatility = Math.sqrt(variance) * Math.sqrt(252); // Annualized

  // Sharpe Ratio (assuming risk-free rate of 0 for simplicity)
  const sharpeRatio = volatility > 0 ? (meanReturn * 252) / volatility : 0;

  // Sortino Ratio (downside deviation only)
  const downsideReturns = dailyReturns.filter(r => r < 0);
  const downsideVariance = downsideReturns.length > 0
    ? downsideReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / downsideReturns.length
    : 0;
  const downsideDeviation = Math.sqrt(downsideVariance) * Math.sqrt(252);
  const sortinoRatio = downsideDeviation > 0 ? (meanReturn * 252) / downsideDeviation : 0;

  // Max Drawdown
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  let peak = first.totalPortfolioValue;
  for (const snap of sorted) {
    if (snap.totalPortfolioValue > peak) {
      peak = snap.totalPortfolioValue;
    }
    const drawdown = peak - snap.totalPortfolioValue;
    const drawdownPct = peak > 0 ? (drawdown / peak) * 100 : 0;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownPct = drawdownPct;
    }
  }

  // Win rate and profit factor
  const positionReturns = sorted.flatMap(s => s.positions.map(p => p.plPct));
  const wins = positionReturns.filter(r => r > 0);
  const losses = positionReturns.filter(r => r < 0);
  const winRate = positionReturns.length > 0 ? wins.length / positionReturns.length : 0;
  const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 0;
  const profitFactor = avgLoss > 0 ? (avgWin * wins.length) / (avgLoss * losses.length) : wins.length > 0 ? 999 : 0;

  // Sleeve performance
  const sleevePerformance: Record<string, { return: number; returnPct: number; contribution: number }> = {};
  const firstSleeves = new Map<string, number>();
  const lastSleeves = new Map<string, number>();

  first.allocations.forEach(a => {
    firstSleeves.set(a.sleeve, a.marketValue);
  });
  last.allocations.forEach(a => {
    lastSleeves.set(a.sleeve, a.marketValue);
  });

  for (const sleeve of ['Core', 'Upside', 'Spec']) {
    const firstVal = firstSleeves.get(sleeve) || 0;
    const lastVal = lastSleeves.get(sleeve) || 0;
    const sleeveReturn = lastVal - firstVal;
    const sleeveReturnPct = firstVal > 0 ? (sleeveReturn / firstVal) * 100 : 0;
    sleevePerformance[sleeve] = {
      return: sleeveReturn,
      returnPct: sleeveReturnPct,
      contribution: totalReturn > 0 ? (sleeveReturn / totalReturn) * 100 : 0,
    };
  }

  return {
    totalReturn,
    totalReturnPct,
    sharpeRatio,
    sortinoRatio,
    maxDrawdown,
    maxDrawdownPct,
    volatility,
    winRate,
    avgWin,
    avgLoss,
    profitFactor,
    sleevePerformance,
  };
}

export function getPerformanceTrend(
  snapshots: PerformanceSnapshot[],
  days: number = 30
): Array<{ date: Date; value: number; returnPct: number }> {
  if (snapshots.length === 0) return [];

  const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
  const filtered = snapshots
    .filter(s => s.timestamp >= cutoff)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (filtered.length === 0) return [];

  const firstValue = filtered[0].totalPortfolioValue;
  return filtered.map(snap => ({
    date: new Date(snap.timestamp),
    value: snap.totalPortfolioValue,
    returnPct: firstValue > 0 ? ((snap.totalPortfolioValue - firstValue) / firstValue) * 100 : 0,
  }));
}

export function getSleeveDriftHistory(
  snapshots: PerformanceSnapshot[]
): Array<{ date: Date; sleeve: string; driftPct: number }> {
  if (snapshots.length === 0) return [];

  const sorted = [...snapshots].sort((a, b) => a.timestamp - b.timestamp);
  const result: Array<{ date: Date; sleeve: string; driftPct: number }> = [];

  for (const snap of sorted) {
    for (const alloc of snap.allocations) {
      result.push({
        date: new Date(snap.timestamp),
        sleeve: alloc.sleeve,
        driftPct: alloc.driftPct,
      });
    }
  }

  return result;
}
