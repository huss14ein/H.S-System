import { describe, it, expect } from 'vitest';
import { extractTadawulCodeForSahmk } from '../services/sahmkQuote';

describe('extractTadawulCodeForSahmk', () => {
  it('parses Saudi suffix forms', () => {
    expect(extractTadawulCodeForSahmk('2222.SR')).toBe('2222');
    expect(extractTadawulCodeForSahmk('2222.sa')).toBe('2222');
    expect(extractTadawulCodeForSahmk('REITF.SE')).toBe('REITF');
  });

  it('accepts bare numeric codes', () => {
    expect(extractTadawulCodeForSahmk('2222')).toBe('2222');
    expect(extractTadawulCodeForSahmk('7010')).toBe('7010');
  });

  it('refuses ambiguous US-style tickers without Saudi suffix', () => {
    expect(extractTadawulCodeForSahmk('AAPL')).toBe(null);
  });
});
