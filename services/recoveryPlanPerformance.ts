/**
 * Recovery Plan Performance Tracking Service
 * Tracks recovery plan execution history and success rates
 */

import type { RecoveryPlanResult } from '../types';

export interface RecoveryPlanExecution {
  id: string;
  symbol: string;
  timestamp: number;
  initialPlPct: number;
  initialPrice: number;
  initialShares: number;
  initialAvgCost: number;
  recoveryConfig: {
    lossTriggerPct: number;
    cashCap: number;
    ladderLevels: number;
    totalPlannedCost: number;
  };
  executionStatus: 'planned' | 'partial' | 'complete' | 'cancelled';
  fills?: Array<{
    level: number;
    qty: number;
    price: number;
    timestamp: number;
  }>;
  currentState?: {
    shares: number;
    avgCost: number;
    currentPrice: number;
    plPct: number;
    recoveryProgress: number; // 0-100%
  };
  outcome?: {
    recovered: boolean;
    recoveryTimeDays?: number;
    finalPlPct: number;
    roi: number;
  };
}

const STORAGE_KEY = 'recovery-plan-executions:v1';
const MAX_EXECUTIONS = 500;

export function saveRecoveryExecution(execution: RecoveryPlanExecution): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = getRecoveryExecutions();
    const updated = [...existing.filter(e => e.id !== execution.id), execution]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, MAX_EXECUTIONS);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (error) {
    console.warn('Failed to save recovery execution:', error);
  }
}

export function getRecoveryExecutions(): RecoveryPlanExecution[] {
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

export function getRecoveryExecutionsBySymbol(symbol: string): RecoveryPlanExecution[] {
  return getRecoveryExecutions().filter(e => e.symbol.toUpperCase() === symbol.toUpperCase());
}

export interface RecoveryPlanStatistics {
  totalExecutions: number;
  successRate: number;
  avgRecoveryTimeDays: number;
  avgRoi: number;
  totalCapitalDeployed: number;
  totalRecovered: number;
  bySymbol: Record<string, {
    count: number;
    successRate: number;
    avgRoi: number;
  }>;
  byTriggerRange: Record<string, {
    count: number;
    successRate: number;
  }>;
}

export function calculateRecoveryStatistics(): RecoveryPlanStatistics {
  const executions = getRecoveryExecutions();
  const completed = executions.filter(e => e.executionStatus === 'complete' && e.outcome);
  
  const totalExecutions = executions.length;
  const successful = completed.filter(e => e.outcome?.recovered).length;
  const successRate = completed.length > 0 ? successful / completed.length : 0;
  
  const recoveryTimes = completed
    .filter(e => e.outcome?.recoveryTimeDays)
    .map(e => e.outcome!.recoveryTimeDays!);
  const avgRecoveryTimeDays = recoveryTimes.length > 0
    ? recoveryTimes.reduce((a, b) => a + b, 0) / recoveryTimes.length
    : 0;
  
  const rois = completed
    .filter(e => e.outcome?.roi)
    .map(e => e.outcome!.roi);
  const avgRoi = rois.length > 0
    ? rois.reduce((a, b) => a + b, 0) / rois.length
    : 0;
  
  const totalCapitalDeployed = executions.reduce((sum, e) => {
    if (e.fills) {
      return sum + e.fills.reduce((fillSum, fill) => fillSum + (fill.qty * fill.price), 0);
    }
    return sum + (e.recoveryConfig.totalPlannedCost || 0);
  }, 0);
  
  const totalRecovered = completed
    .filter(e => e.outcome?.recovered)
    .reduce((sum, e) => {
      const initialValue = e.initialShares * e.initialPrice;
      const finalValue = e.currentState ? e.currentState.shares * e.currentState.currentPrice : initialValue;
      return sum + Math.max(0, finalValue - initialValue);
    }, 0);
  
  // Group by symbol
  const bySymbol: Record<string, { count: number; successRate: number; avgRoi: number }> = {};
  executions.forEach(e => {
    const sym = e.symbol.toUpperCase();
    if (!bySymbol[sym]) {
      bySymbol[sym] = { count: 0, successRate: 0, avgRoi: 0 };
    }
    bySymbol[sym].count++;
  });
  
  Object.keys(bySymbol).forEach(sym => {
    const symExecutions = executions.filter(e => e.symbol.toUpperCase() === sym);
    const symCompleted = symExecutions.filter(e => e.executionStatus === 'complete' && e.outcome);
    const symSuccessful = symCompleted.filter(e => e.outcome?.recovered).length;
    bySymbol[sym].successRate = symCompleted.length > 0 ? symSuccessful / symCompleted.length : 0;
    const symRois = symCompleted.filter(e => e.outcome?.roi).map(e => e.outcome!.roi);
    bySymbol[sym].avgRoi = symRois.length > 0 ? symRois.reduce((a, b) => a + b, 0) / symRois.length : 0;
  });
  
  // Group by trigger range
  const byTriggerRange: Record<string, { count: number; successRate: number }> = {};
  executions.forEach(e => {
    const trigger = e.recoveryConfig.lossTriggerPct;
    const range = trigger < 15 ? '10-15%' : trigger < 20 ? '15-20%' : trigger < 25 ? '20-25%' : '25%+';
    if (!byTriggerRange[range]) {
      byTriggerRange[range] = { count: 0, successRate: 0 };
    }
    byTriggerRange[range].count++;
  });
  
  Object.keys(byTriggerRange).forEach(range => {
    const rangeExecutions = executions.filter(e => {
      const trigger = e.recoveryConfig.lossTriggerPct;
      const execRange = trigger < 15 ? '10-15%' : trigger < 20 ? '15-20%' : trigger < 25 ? '20-25%' : '25%+';
      return execRange === range;
    });
    const rangeCompleted = rangeExecutions.filter(e => e.executionStatus === 'complete' && e.outcome);
    const rangeSuccessful = rangeCompleted.filter(e => e.outcome?.recovered).length;
    byTriggerRange[range].successRate = rangeCompleted.length > 0 ? rangeSuccessful / rangeCompleted.length : 0;
  });
  
  return {
    totalExecutions,
    successRate,
    avgRecoveryTimeDays,
    avgRoi,
    totalCapitalDeployed,
    totalRecovered,
    bySymbol,
    byTriggerRange,
  };
}

export function updateRecoveryExecutionOutcome(
  executionId: string,
  currentState: {
    shares: number;
    avgCost: number;
    currentPrice: number;
    plPct: number;
  }
): void {
  const executions = getRecoveryExecutions();
  const execution = executions.find(e => e.id === executionId);
  if (!execution) return;
  
  const initialPlPct = execution.initialPlPct;
  const recovered = currentState.plPct > -5; // Consider recovered if within 5% of breakeven
  const recoveryProgress = initialPlPct < 0
    ? Math.min(100, Math.max(0, ((currentState.plPct - initialPlPct) / Math.abs(initialPlPct)) * 100))
    : 0;
  
  const daysSinceStart = execution.currentState
    ? Math.floor((Date.now() - execution.timestamp) / (1000 * 60 * 60 * 24))
    : 0;
  
  const capitalDeployed = execution.fills
    ? execution.fills.reduce((sum, fill) => sum + (fill.qty * fill.price), 0)
    : execution.recoveryConfig.totalPlannedCost;
  
  const roi = capitalDeployed > 0 && execution.currentState
    ? ((currentState.plPct - initialPlPct) / 100) * (capitalDeployed / execution.initialShares / execution.initialPrice)
    : 0;
  
  execution.currentState = {
    ...currentState,
    recoveryProgress,
  };
  
  execution.executionStatus = recovered ? 'complete' : execution.executionStatus;
  
  if (recovered || execution.executionStatus === 'complete') {
    execution.outcome = {
      recovered,
      recoveryTimeDays: recovered ? daysSinceStart : undefined,
      finalPlPct: currentState.plPct,
      roi,
    };
  }
  
  saveRecoveryExecution(execution);
}
