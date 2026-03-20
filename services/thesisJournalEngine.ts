/**
 * Thesis and journal system (spec §30).
 * Buy thesis, expected upside, invalidation point, review date, post-result reflection.
 */

export interface ThesisRecord {
  id?: string;
  symbol: string;
  buyThesis: string;
  expectedUpsidePct?: number;
  expectedTimeline?: string;
  keyRisks?: string;
  catalystDates?: string;
  invalidationPoint?: string;
  reviewDate?: string;
  createdAt: string;
  /** Filled after exit. */
  postResultReflection?: string;
}

/** Create a thesis record (in-memory or persist via caller). */
export function createThesisRecord(args: Omit<ThesisRecord, 'createdAt'>): ThesisRecord {
  return {
    ...args,
    createdAt: new Date().toISOString(),
  };
}

/** Check if thesis is still valid (e.g. review date passed). */
export function thesisValidityCheck(thesis: ThesisRecord, asOf?: Date): { valid: boolean; reason: string } {
  const now = asOf ?? new Date();
  if (thesis.reviewDate && new Date(thesis.reviewDate) < now) {
    return { valid: false, reason: 'Review date passed; reassess thesis.' };
  }
  return { valid: true, reason: 'OK' };
}

/** Journal outcome after closing position. */
export function journalOutcomeReview(args: {
  thesis: ThesisRecord;
  actualReturnPct: number;
  reflection: string;
}): ThesisRecord {
  return {
    ...args.thesis,
    postResultReflection: args.reflection,
  };
}

/** Emit when price or event crosses invalidation point. */
export function thesisBreakAlert(args: {
  thesis: ThesisRecord;
  currentPrice: number;
  invalidationPrice?: number;
  reason?: string;
}): { alert: boolean; message: string } {
  if (args.reason) return { alert: true, message: args.reason };
  if (args.invalidationPrice != null && args.currentPrice <= args.invalidationPrice) {
    return { alert: true, message: `Price at or below invalidation level for ${args.thesis.symbol}.` };
  }
  return { alert: false, message: '' };
}
