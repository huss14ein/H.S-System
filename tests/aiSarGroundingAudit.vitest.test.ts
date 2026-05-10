import { describe, it, expect } from 'vitest';
import {
  auditSarGrounding,
  extractCorpusNumericAllowlist,
  flattenAiContentsForGrounding,
} from '../utils/aiSarGroundingAudit';

describe('aiSarGroundingAudit', () => {
  it('flags SAR amounts missing from corpus', () => {
    const corpus = 'Net worth 1,234,567 SAR and cash 900.';
    const reply = 'Your runway is roughly **999,999 SAR** after adjustments.';
    const r = auditSarGrounding(reply, corpus);
    expect(r.clean).toBe(false);
    expect(r.violations.some((v) => Math.abs(v.value - 999999) < 1)).toBe(true);
  });

  it('passes when SAR figure appears in corpus (formatting tolerant)', () => {
    const corpus = 'portfolio total 4523188.42';
    const reply = 'Total is **4,523,188.42 SAR** which matches.';
    expect(auditSarGrounding(reply, corpus).clean).toBe(true);
  });

  it('ignores SAR-unrelated numbers in reply', () => {
    const corpus = 'x 100 SAR';
    const reply = 'Use a 50/50 split · not about SAR totals here.';
    expect(auditSarGrounding(reply, corpus).clean).toBe(true);
  });

  it('flattenAiContentsForGrounding joins chat turns and tool payloads', () => {
    const flat = flattenAiContentsForGrounding([
      { role: 'user', parts: [{ text: 'Net 12,000 SAR' }] },
      { role: 'model', parts: [{ functionCall: { name: 'getNetWorth', args: {} } }] },
      { role: 'tool', parts: [{ functionResponse: { name: 'getNetWorth', response: { result: '{"netWorth":12000}' } } }] },
    ]);
    expect(flat).toContain('12,000');
    expect(flat).toContain('12000');
  });

  it('extractCorpusNumericAllowlist captures comma decimals', () => {
    const s = extractCorpusNumericAllowlist('a 1,250.5 b 9000');
    expect(s.has(1250.5)).toBe(true);
    expect(s.has(9000)).toBe(true);
  });
});
