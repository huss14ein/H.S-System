/**
 * Map imported transactions (parser `category` + description) to an existing budget row `category`
 * when names differ (e.g. parser "Food" vs budget "Meals & Groceries").
 */

import type { Transaction } from '../types';

function normalizeText(v: string): string {
  return String(v || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(v: string): Set<string> {
  return new Set(normalizeText(v).split(' ').filter((t) => t.length >= 2));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  a.forEach((x) => {
    if (b.has(x)) inter++;
  });
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

/** Parser / app transaction categories → English keywords for matching budget labels */
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  food: ['food', 'meal', 'dining', 'grocery', 'grocer', 'restaurant', 'cafe', 'coffee', 'مطعم', 'مقهى', 'بقالة'],
  transportation: ['transport', 'car', 'fuel', 'uber', 'taxi', 'metro', 'vehicle', 'gas', 'petrol', 'نقل', 'وقود', 'سيارة'],
  housing: ['housing', 'rent', 'lease', 'apartment', 'mortgage', 'إيجار', 'سكن'],
  utilities: ['utilities', 'utility', 'electric', 'water', 'internet', 'bill', 'كهرباء', 'مياه', 'انترنت', 'إنترنت', 'فاتورة'],
  telecommunications: ['telecom', 'mobile', 'phone', 'sim', 'stc', 'mobily', 'zain', 'اتصالات', 'جوال', 'شريحة'],
  entertainment: ['entertain', 'cinema', 'movie', 'netflix', 'game', 'subscription', 'ترفيه', 'سينما'],
  shopping: ['shop', 'retail', 'store', 'mall', 'amazon', 'متجر', 'تسوق'],
  health: ['health', 'pharmacy', 'clinic', 'hospital', 'medical', 'صيدلية', 'مستشفى', 'صحة'],
  education: ['education', 'school', 'tuition', 'course', 'university', 'تعليم', 'جامعة', 'مدرسة'],
  travel: ['travel', 'hotel', 'flight', 'airline', 'trip', 'سفر', 'فندق', 'طيران'],
  income: ['income', 'salary', 'payroll', 'deposit', 'راتب'],
};

/**
 * Pick the best matching budget category name for an expense import.
 * Returns undefined if there are no budgets or the transaction is not an expense.
 */
export function resolveBudgetCategoryForImportedExpense(
  tx: Pick<Transaction, 'type' | 'category' | 'description' | 'budgetCategory'>,
  budgetCategoryNames: string[],
): string | undefined {
  const names = Array.from(new Set(budgetCategoryNames.map((s) => String(s || '').trim()).filter(Boolean)));
  if (names.length === 0) return undefined;
  if (tx.type !== 'expense') return undefined;

  const existing = String(tx.budgetCategory || '').trim();
  if (existing && names.includes(existing)) return existing;

  const txCatNorm = normalizeText(String(tx.category || ''));
  const descNorm = normalizeText(String(tx.description || ''));
  const combinedTokens = tokenSet(`${tx.category || ''} ${tx.description || ''}`);

  let best: { name: string; score: number } | null = null;

  for (const b of names) {
    const bNorm = normalizeText(b);
    const bTokens = tokenSet(b);
    let score = jaccard(combinedTokens, bTokens) * 8;

    if (txCatNorm && (bNorm === txCatNorm || bNorm.includes(txCatNorm) || txCatNorm.includes(bNorm))) {
      score += 6;
    }

    for (const [, words] of Object.entries(CATEGORY_KEYWORDS)) {
      const txBucketHit = words.some((w) => txCatNorm.includes(w) || descNorm.includes(w));
      const budgetHit = words.some((w) => bNorm.includes(w));
      if (txBucketHit && budgetHit) score += 4;
    }

    if (!best || score > best.score) best = { name: b, score };
  }

  if (best && best.score >= 0.85) return best.name;

  const fuzzy = names
    .map((b) => ({
      name: b,
      score: jaccard(combinedTokens, tokenSet(b)) * 10 + (normalizeText(b).length > 0 ? 0.01 : 0),
    }))
    .sort((a, b) => b.score - a.score)[0];
  if (fuzzy && fuzzy.score >= 0.35) return fuzzy.name;

  if (best && best.score > 0) return best.name;

  return names.length === 1 ? names[0] : undefined;
}
