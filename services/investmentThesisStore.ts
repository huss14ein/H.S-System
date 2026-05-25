import type { SupabaseClient } from '@supabase/supabase-js';
import type { ThesisRecord } from './thesisJournalEngine';

export type JournalDbEntry = {
  id: string;
  symbol?: string;
  entryType: string;
  body: string;
  tags?: string[];
  createdAt: string;
};

const THESIS_META_MARKER = '---finova-thesis-meta---';

type ThesisMetaPayload = {
  expectedUpsidePct?: number;
  expectedTimeline?: string;
  keyRisks?: string;
  catalystDates?: string;
  invalidationPoint?: string;
  postResultReflection?: string;
};

export function serializeThesisForDb(record: ThesisRecord): { body: string; conviction: number | null; status: string } {
  const meta: ThesisMetaPayload = {
    expectedUpsidePct: record.expectedUpsidePct,
    expectedTimeline: record.expectedTimeline,
    keyRisks: record.keyRisks,
    catalystDates: record.catalystDates,
    invalidationPoint: record.invalidationPoint,
    postResultReflection: record.postResultReflection,
  };
  const conviction =
    record.expectedUpsidePct != null && Number.isFinite(record.expectedUpsidePct)
      ? Math.max(1, Math.min(5, Math.round(record.expectedUpsidePct / 20)))
      : null;
  const body = `${THESIS_META_MARKER}\n${JSON.stringify(meta)}\n\n${(record.buyThesis || '').trim()}`;
  return { body, conviction, status: record.postResultReflection ? 'closed' : 'active' };
}

export function parseThesisFromDbRow(r: Record<string, unknown>): ThesisRecord {
  const rawBody = String(r.body ?? '');
  let buyThesis = rawBody;
  let meta: ThesisMetaPayload = {};
  const markerIdx = rawBody.indexOf(THESIS_META_MARKER);
  if (markerIdx >= 0) {
    const after = rawBody.slice(markerIdx + THESIS_META_MARKER.length).trim();
    const split = after.indexOf('\n\n');
    const jsonPart = split >= 0 ? after.slice(0, split).trim() : after.split('\n')[0]?.trim();
    try {
      meta = JSON.parse(jsonPart) as ThesisMetaPayload;
      buyThesis = split >= 0 ? after.slice(split + 2).trim() : '';
    } catch {
      buyThesis = rawBody;
    }
  }
  return {
    id: r.id != null ? String(r.id) : undefined,
    symbol: String(r.symbol ?? '').toUpperCase(),
    buyThesis,
    expectedUpsidePct: meta.expectedUpsidePct,
    expectedTimeline: meta.expectedTimeline,
    keyRisks: meta.keyRisks,
    catalystDates: meta.catalystDates,
    invalidationPoint: meta.invalidationPoint,
    reviewDate: r.review_date != null ? String(r.review_date).slice(0, 10) : undefined,
    postResultReflection: meta.postResultReflection,
    createdAt: String(r.created_at ?? new Date().toISOString()),
  };
}

export async function fetchInvestmentJournalEntries(
  supabase: SupabaseClient,
  userId: string,
  limit = 200,
): Promise<JournalDbEntry[]> {
  const { data, error } = await supabase
    .from('investment_journal_entries')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    symbol: r.symbol != null ? String(r.symbol) : undefined,
    entryType: String(r.entry_type ?? r.entryType ?? 'note'),
    body: String(r.body ?? ''),
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : undefined,
    createdAt: String(r.created_at ?? new Date().toISOString()),
  }));
}

export async function insertInvestmentJournalEntry(
  supabase: SupabaseClient,
  userId: string,
  input: { symbol?: string; entryType?: string; body: string; tags?: string[] },
): Promise<JournalDbEntry> {
  const row = {
    user_id: userId,
    symbol: input.symbol?.trim().toUpperCase() || null,
    entry_type: input.entryType ?? 'note',
    body: input.body,
    tags: input.tags ?? null,
  };
  const { data, error } = await supabase.from('investment_journal_entries').insert(row).select().single();
  if (error) throw error;
  return {
    id: String(data.id),
    symbol: data.symbol ?? undefined,
    entryType: String(data.entry_type ?? 'note'),
    body: String(data.body ?? ''),
    tags: Array.isArray(data.tags) ? data.tags : undefined,
    createdAt: String(data.created_at),
  };
}

export async function deleteInvestmentJournalEntry(
  supabase: SupabaseClient,
  userId: string,
  entryId: string,
): Promise<void> {
  const { error } = await supabase
    .from('investment_journal_entries')
    .delete()
    .eq('user_id', userId)
    .eq('id', entryId);
  if (error) throw error;
}

export async function fetchInvestmentTheses(
  supabase: SupabaseClient,
  userId: string,
): Promise<ThesisRecord[]> {
  const { data, error } = await supabase.from('investment_thesis').select('*').eq('user_id', userId);
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => parseThesisFromDbRow(r));
}

export async function upsertInvestmentThesis(
  supabase: SupabaseClient,
  userId: string,
  record: ThesisRecord,
): Promise<void> {
  const { body, conviction, status } = serializeThesisForDb(record);
  const row = {
    user_id: userId,
    symbol: record.symbol.toUpperCase(),
    review_date: record.reviewDate ?? null,
    status,
    body,
    conviction,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('investment_thesis').upsert(row, { onConflict: 'user_id,symbol' });
  if (error) throw error;
}

export async function deleteInvestmentThesis(
  supabase: SupabaseClient,
  userId: string,
  symbol: string,
): Promise<void> {
  const { error } = await supabase
    .from('investment_thesis')
    .delete()
    .eq('user_id', userId)
    .eq('symbol', symbol.toUpperCase());
  if (error) throw error;
}
