/** Store expense splits inside `note` so any DB schema works. */

export const SPLIT_MARKER = '__FINOVA_SPLITS__';

export interface SplitLineRow {
  category: string;
  amount: number;
}

export function encodeNoteWithSplits(userNote: string | undefined, lines: SplitLineRow[]): string {
  const payload = JSON.stringify({ lines });
  const base = (userNote || '').trim();
  return base ? `${base}\n${SPLIT_MARKER}\n${payload}` : `${SPLIT_MARKER}\n${payload}`;
}

export function parseSplitsFromNote(note?: string | null): {
  cleanNote: string | undefined;
  splitLines: SplitLineRow[] | undefined;
} {
  const n = (note || '').trim();
  if (!n.includes(SPLIT_MARKER)) {
    return { cleanNote: note?.trim() || undefined, splitLines: undefined };
  }
  const [before, after] = n.split(SPLIT_MARKER);
  const cleanNote = before.trim() || undefined;
  try {
    const j = JSON.parse((after || '').trim());
    const lines = Array.isArray(j.lines)
      ? j.lines
          .filter((x: unknown) => x && typeof x === 'object')
          .map((x: { category?: string; amount?: number }) => ({
            category: String(x.category ?? '').trim() || 'Uncategorized',
            amount: Math.abs(Number(x.amount) || 0),
          }))
          .filter((x: SplitLineRow) => x.amount > 0)
      : [];
    return { cleanNote, splitLines: lines.length ? lines : undefined };
  } catch {
    return { cleanNote: n, splitLines: undefined };
  }
}
