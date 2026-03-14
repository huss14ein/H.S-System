import { describe, it, expect } from 'vitest';
import { safeSymbol, holdingDisplayLabel } from './holdingUtils';

describe('safeSymbol', () => {
  it('returns trimmed string when defined', () => {
    expect(safeSymbol('  AAPL  ')).toBe('AAPL');
    expect(safeSymbol('SAR')).toBe('SAR');
  });
  it('returns empty string for undefined or null', () => {
    expect(safeSymbol(undefined)).toBe('');
    expect(safeSymbol('')).toBe('');
  });
  it('handles whitespace-only', () => {
    expect(safeSymbol('   ')).toBe('');
  });
});

describe('holdingDisplayLabel', () => {
  it('returns symbol when present', () => {
    expect(holdingDisplayLabel({ symbol: 'AAPL' })).toBe('AAPL');
    expect(holdingDisplayLabel({ symbol: 'X', name: 'Company' })).toBe('X');
  });
  it('returns name when symbol is empty and name present', () => {
    expect(holdingDisplayLabel({ symbol: '', name: 'Al Rajhi Fund' })).toBe('Al Rajhi Fund');
    expect(holdingDisplayLabel({ name: 'Manual Fund' })).toBe('Manual Fund');
  });
  it('returns "Manual" when neither symbol nor name', () => {
    expect(holdingDisplayLabel({})).toBe('Manual');
    expect(holdingDisplayLabel({ symbol: '', name: '' })).toBe('Manual');
  });
});
