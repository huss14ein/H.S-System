/**
 * Auto-sync conviction & quality for Recovery / recycling from universe thesis tier,
 * watchlist scores, journal thesis validity, and risk tier — with optional user override.
 */

import type { ThesisRecord } from './thesisJournalEngine';
import { thesisValidityCheck } from './thesisJournalEngine';
import type { ConvictionGrade, StockQualityStatus } from './positionRecyclingPlan';
import {
  inferConvictionFromUniverseStatus,
  inferConvictionGradeFromRiskTier,
  inferStockQualityFromPlPct,
  resolveUniverseStatusForSymbol,
} from './positionRecyclingIntegration';
import type { WealthUltraRiskTier } from '../types';

const THESIS_STORAGE_KEY = 'finova_thesis_records_v1';

export type WatchlistScoreInput = {
  symbol: string;
  userScore?: number;
  signalScore?: number;
};

export type ResolvedRecoveryConviction = {
  convictionGrade: ConvictionGrade;
  stockQualityStatus: StockQualityStatus;
  /** Human-readable provenance for UI. */
  sources: string[];
  universeStatus?: string;
  watchlistBlend?: number;
  thesisValid?: boolean;
  userOverride: boolean;
};

function watchlistBlendScore(item: WatchlistScoreInput): number {
  const u = Number(item.userScore);
  const s = Number(item.signalScore);
  const user = Number.isFinite(u) ? u : 50;
  const sig = Number.isFinite(s) ? s : 50;
  return user * 0.6 + sig * 0.4;
}

/** Map 0–100 watchlist blend → conviction grade. */
export function convictionGradeFromWatchlistBlend(blend: number): ConvictionGrade {
  if (blend >= 72) return 'A';
  if (blend >= 58) return 'B';
  if (blend >= 42) return 'C';
  return 'D';
}

function gradeRank(g: ConvictionGrade): number {
  return g === 'A' ? 4 : g === 'B' ? 3 : g === 'C' ? 2 : 1;
}

function pickStrongerGrade(a: ConvictionGrade, b: ConvictionGrade): ConvictionGrade {
  return gradeRank(a) >= gradeRank(b) ? a : b;
}

function pickWeakerGrade(a: ConvictionGrade, b: ConvictionGrade): ConvictionGrade {
  return gradeRank(a) <= gradeRank(b) ? a : b;
}

export function loadThesisRecordsFromClientStorage(): ThesisRecord[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = window.localStorage.getItem(THESIS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ThesisRecord[]) : [];
  } catch {
    return [];
  }
}

export function findLatestThesisForSymbol(
  symbol: string,
  records?: ThesisRecord[],
): ThesisRecord | undefined {
  const sym = symbol.toUpperCase();
  const list = records ?? loadThesisRecordsFromClientStorage();
  return list
    .filter((t) => (t.symbol ?? '').toUpperCase() === sym)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
}

/**
 * Resolve conviction & quality for recycling / unified recovery.
 * User pref wins when set; otherwise blends universe, watchlist, thesis, P/L, risk tier.
 */
export function resolveSyncedRecoveryConviction(args: {
  symbol: string;
  plPct: number;
  riskTier: WealthUltraRiskTier;
  universe?: Array<{ ticker?: string; status?: string }>;
  watchlistItems?: WatchlistScoreInput[];
  thesisRecords?: ThesisRecord[];
  userConvictionGrade?: ConvictionGrade;
  userStockQuality?: StockQualityStatus;
}): ResolvedRecoveryConviction {
  const sym = args.symbol.toUpperCase();
  const sources: string[] = [];
  const userOverride = Boolean(args.userConvictionGrade || args.userStockQuality);

  if (args.userConvictionGrade) {
    sources.push(`Manual conviction ${args.userConvictionGrade}`);
  }
  if (args.userStockQuality) {
    sources.push(`Manual quality ${args.userStockQuality}`);
  }

  const universeStatus = resolveUniverseStatusForSymbol(sym, args.universe ?? []);
  let grade: ConvictionGrade =
    args.userConvictionGrade ??
    inferConvictionFromUniverseStatus(universeStatus) ??
    inferConvictionGradeFromRiskTier(args.riskTier);

  if (universeStatus && !args.userConvictionGrade) {
    sources.push(`Universe: ${universeStatus} → ${grade}`);
  }

  const wl = (args.watchlistItems ?? []).find((w) => (w.symbol ?? '').toUpperCase() === sym);
  let watchlistBlend: number | undefined;
  if (wl && !args.userConvictionGrade) {
    watchlistBlend = watchlistBlendScore(wl);
    const wlGrade = convictionGradeFromWatchlistBlend(watchlistBlend);
    grade = pickStrongerGrade(grade, wlGrade);
    sources.push(`Watchlist blend ${watchlistBlend.toFixed(0)} → ${wlGrade}`);
  }

  const thesis = findLatestThesisForSymbol(sym, args.thesisRecords);
  let thesisValid: boolean | undefined;
  if (thesis && !args.userConvictionGrade) {
    const validity = thesisValidityCheck(thesis);
    thesisValid = validity.valid;
    if (!validity.valid) {
      grade = pickWeakerGrade(grade, 'D');
      sources.push(`Thesis review due → cap ${grade}`);
    } else if (thesis.buyThesis?.trim()) {
      grade = pickStrongerGrade(grade, 'B');
      sources.push('Active buy thesis → support B+');
    }
  }

  let quality: StockQualityStatus =
    args.userStockQuality ?? inferStockQualityFromPlPct(args.plPct);
  if (!args.userStockQuality) {
    sources.push(`P/L ${args.plPct.toFixed(1)}% → quality ${quality}`);
  }
  if (thesis && !validityCheckBroken(thesis, args.plPct)) {
    if (!args.userStockQuality && quality === 'Broken' && thesisValid) {
      quality = 'Weak';
      sources.push('Thesis still valid — quality floored at Weak');
    }
  }

  if (!args.userConvictionGrade && !universeStatus && !wl) {
    sources.push(`Risk tier ${args.riskTier} → ${grade}`);
  }

  return {
    convictionGrade: grade,
    stockQualityStatus: quality,
    sources,
    universeStatus,
    watchlistBlend,
    thesisValid,
    userOverride,
  };
}

function validityCheckBroken(thesis: ThesisRecord, plPct: number): boolean {
  if (plPct <= -40) return true;
  return !thesisValidityCheck(thesis).valid;
}

/** Build watchlist score rows from holdings + optional price change map (Watchlist-style signal). */
export function buildWatchlistScoresFromItems(
  watchlist: Array<{ symbol: string; name?: string }>,
  priceChangePctBySymbol?: Record<string, number>,
): WatchlistScoreInput[] {
  return watchlist.map((w) => {
    const sym = (w.symbol ?? '').toUpperCase();
    const ch = priceChangePctBySymbol?.[sym] ?? 0;
    const signalScore = Math.max(0, Math.min(100, 50 + ch * 3));
    return { symbol: sym, userScore: 50, signalScore };
  });
}
