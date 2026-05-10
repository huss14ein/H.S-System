/**
 * Post-generation check: detect SAR-denominated figures in model text that do not appear
 * anywhere in the grounding corpus (prompt + tools + caller-provided extra).
 *
 * Conservative: only flags amounts explicitly tied to SAR (or common SAR tokens) in the reply.
 */

/** Match "12,345.67 SAR", "SAR 1,000", Arabic digit variants near SAR tokens. */
const REPLY_SAR_PAIR =
  /(\d[\d\u0660-\u0669,.\s\u00a0]*)\s*(?:SAR|ريال|ر\.س|﷼)|(?:SAR|ريال|ر\.س|﷼)\s*(\d[\d\u0660-\u0669,.\s\u00a0]*)/gi;

/** Matches Western-style grouped or plain decimals/integers used in prompts and JSON. */
const CORPUS_NUMBER_RE = /-?(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+|\d+)/g;

function normalizeWesternDigits(s: string): string {
  return s.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

function parseLooseNumber(raw: string): number | null {
  const cleaned = normalizeWesternDigits(raw).replace(/[\s\u00a0]/g, '').replace(/,/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Collect scalar numbers from plain text (prompt, JSON coerced to string). */
export function extractCorpusNumericAllowlist(corpus: string): Set<number> {
  const set = new Set<number>();
  const text = normalizeWesternDigits(corpus);
  let m: RegExpExecArray | null;
  const re = new RegExp(CORPUS_NUMBER_RE.source, 'g');
  while ((m = re.exec(text)) !== null) {
    const n = parseLooseNumber(m[0]);
    if (n !== null && Math.abs(n) < 1e15) {
      set.add(roundForCompare(n));
    }
  }
  return set;
}

function roundForCompare(n: number): number {
  if (!Number.isFinite(n)) return n;
  return Math.round(n * 100) / 100;
}

function nearlyAllowed(n: number, allowed: Set<number>): boolean {
  const r = roundForCompare(n);
  if (allowed.has(r)) return true;
  if (allowed.has(roundForCompare(r - 0.01)) || allowed.has(roundForCompare(r + 0.01))) return true;
  const tol = Math.max(0.02, Math.abs(r) * 1e-6);
  for (const a of allowed) {
    if (Math.abs(a - r) <= tol) return true;
  }
  return false;
}

export type SarGroundingViolation = { raw: string; value: number };

/**
 * Find SAR-tagged amounts in model output and flag any whose scalar is not in the corpus allowlist.
 */
export function auditSarGrounding(modelText: string, corpus: string): { clean: boolean; violations: SarGroundingViolation[] } {
  const trimmed = (modelText || '').trim();
  if (!trimmed) return { clean: true, violations: [] };

  const allowed = extractCorpusNumericAllowlist(corpus || '');
  const violations: SarGroundingViolation[] = [];
  const seen = new Set<string>();

  const re = new RegExp(REPLY_SAR_PAIR.source, 'gi');
  for (const m of trimmed.matchAll(re)) {
    const rawNum = (m[1] || m[2] || '').trim();
    if (!rawNum) continue;
    const value = parseLooseNumber(rawNum);
    if (value === null) continue;
    if (nearlyAllowed(value, allowed)) continue;
    const key = `${roundForCompare(value)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    violations.push({ raw: m[0].trim().slice(0, 80), value });
  }

  return { clean: violations.length === 0, violations };
}

export function appendSarGroundingNotice(modelText: string, violations: SarGroundingViolation[]): string {
  if (!violations.length) return modelText;
  const examples = violations
    .slice(0, 4)
    .map((v) => `**${v.value.toLocaleString(undefined, { maximumFractionDigits: 2 })} SAR**`)
    .join(', ');
  const more = violations.length > 4 ? ` (+${violations.length - 4} more)` : '';
  return `${modelText.trimEnd()}\n\n---\n*Consistency check: this reply cites SAR figure(s) (${examples}${more}) that do not appear in the supplied Finova data—please verify against in-app numbers before acting.*\n`;
}

/** Flatten Gemini-style `contents` for grounding comparison. */
export function flattenAiContentsForGrounding(contents: unknown): string {
  if (contents === null || contents === undefined) return '';
  if (typeof contents === 'string') return contents;
  try {
    if (Array.isArray(contents)) {
      const parts: string[] = [];
      for (const item of contents) {
        if (!item || typeof item !== 'object') continue;
        const o = item as Record<string, unknown>;
        if (Array.isArray(o.parts)) {
          for (const p of o.parts) {
            if (!p || typeof p !== 'object') continue;
            const pt = p as Record<string, unknown>;
            if (typeof pt.text === 'string') parts.push(pt.text);
            const fr = pt.functionResponse as { response?: unknown } | undefined;
            if (fr && fr.response !== undefined) {
              parts.push(typeof fr.response === 'string' ? fr.response : JSON.stringify(fr.response));
            }
            const fc = pt.functionCall as { name?: string; args?: unknown } | undefined;
            if (fc) parts.push(JSON.stringify(fc));
          }
        }
        if (typeof o.text === 'string') parts.push(o.text);
        const frTop = o.functionResponse as { response?: unknown } | undefined;
        if (frTop && frTop.response !== undefined) {
          parts.push(typeof frTop.response === 'string' ? frTop.response : JSON.stringify(frTop.response));
        }
        const fcTop = o.functionCall as { name?: string; args?: unknown } | undefined;
        if (fcTop) parts.push(JSON.stringify(fcTop));
      }
      return parts.join('\n');
    }
    if (typeof contents === 'object') {
      return JSON.stringify(contents);
    }
  } catch {
    /* fall through */
  }
  return String(contents);
}
