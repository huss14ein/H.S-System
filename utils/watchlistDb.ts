import type { WatchlistItem } from '../types';

export function normalizeWatchlistRow(raw: Record<string, unknown>): WatchlistItem {
  const symbol = String(raw.symbol ?? '').toUpperCase();
  return {
    user_id: raw.user_id as string | undefined,
    symbol,
    name: String(raw.name ?? symbol).trim() || symbol,
    targetBuyLow: raw.target_buy_low != null ? Number(raw.target_buy_low) : raw.targetBuyLow != null ? Number(raw.targetBuyLow) : undefined,
    targetBuyHigh: raw.target_buy_high != null ? Number(raw.target_buy_high) : raw.targetBuyHigh != null ? Number(raw.targetBuyHigh) : undefined,
    fairValue: raw.fair_value != null ? Number(raw.fair_value) : raw.fairValue != null ? Number(raw.fairValue) : undefined,
    qualityScore: raw.quality_score != null ? Number(raw.quality_score) : raw.qualityScore != null ? Number(raw.qualityScore) : undefined,
    valuationScore: raw.valuation_score != null ? Number(raw.valuation_score) : raw.valuationScore != null ? Number(raw.valuationScore) : undefined,
    catalyst: (raw.catalyst as string) ?? undefined,
    thesisStatus: (raw.thesis_status as string) ?? (raw.thesisStatus as string) ?? undefined,
    researchNotes: (raw.research_notes as string) ?? (raw.researchNotes as string) ?? undefined,
  };
}

export function watchlistToDbRow(item: WatchlistItem, userId: string): Record<string, unknown> {
  const symbol = String(item.symbol || '').trim().toUpperCase();
  return {
    user_id: userId,
    symbol,
    name: String(item.name || symbol).trim() || symbol,
    target_buy_low: item.targetBuyLow ?? null,
    target_buy_high: item.targetBuyHigh ?? null,
    fair_value: item.fairValue ?? null,
    quality_score: item.qualityScore ?? null,
    valuation_score: item.valuationScore ?? null,
    catalyst: item.catalyst ?? null,
    thesis_status: item.thesisStatus ?? null,
    research_notes: item.researchNotes ?? null,
  };
}
