import { describe, expect, it } from 'vitest';
import { normalizeFinnhubMarketSession } from '../services/finnhubService';

describe('normalizeFinnhubMarketSession', () => {
  it('normalizes common Finnhub / API variants', () => {
    expect(normalizeFinnhubMarketSession('regular')).toBe('regular');
    expect(normalizeFinnhubMarketSession('REGULAR')).toBe('regular');
    expect(normalizeFinnhubMarketSession('open')).toBe('regular');
    expect(normalizeFinnhubMarketSession('closed')).toBe('closed');
    expect(normalizeFinnhubMarketSession('close')).toBe('closed');
    expect(normalizeFinnhubMarketSession('pre-market')).toBe('pre-market');
    expect(normalizeFinnhubMarketSession('pre_market')).toBe('pre-market');
    expect(normalizeFinnhubMarketSession('PRE MARKET')).toBe('pre-market');
    expect(normalizeFinnhubMarketSession('premarket')).toBe('pre-market');
    expect(normalizeFinnhubMarketSession('post-market')).toBe('post-market');
    expect(normalizeFinnhubMarketSession('post_market')).toBe('post-market');
    expect(normalizeFinnhubMarketSession('after-hours')).toBe('post-market');
    expect(normalizeFinnhubMarketSession('afterhours')).toBe('post-market');
  });

  it('returns unknown for empty or placeholder input', () => {
    expect(normalizeFinnhubMarketSession('')).toBe('unknown');
    expect(normalizeFinnhubMarketSession('   ')).toBe('unknown');
    expect(normalizeFinnhubMarketSession('unknown')).toBe('unknown');
    expect(normalizeFinnhubMarketSession('n/a')).toBe('unknown');
  });

  it('passes through unrecognized tokens lowercased', () => {
    expect(normalizeFinnhubMarketSession('halted')).toBe('halted');
  });
});
