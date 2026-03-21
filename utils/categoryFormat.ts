/**
 * Format budget/category names for display: capitalize first letter of each word.
 * e.g. "food & dining" → "Food & Dining", "utilities" → "Utilities"
 */
export function capitalizeCategoryName(str: string): string {
  if (!str || typeof str !== 'string') return str;
  return str.trim().replace(/\b\w/g, c => c.toUpperCase());
}
