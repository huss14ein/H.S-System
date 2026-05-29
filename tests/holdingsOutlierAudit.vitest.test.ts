import { describe, expect, it } from 'vitest';
import { findHoldingsValueOutliers } from '../services/holdingsOutlierAudit';
import type { FinancialData } from '../types';

describe('holdingsOutlierAudit', () => {
  it('flags extreme current_value', () => {
    const data = {
      investments: [
        {
          id: 'p1',
          name: 'Main',
          holdings: [{ id: 'h1', symbol: '2222', quantity: 10, currentValue: 2e12 }],
        },
      ],
    } as unknown as FinancialData;
    const rows = findHoldingsValueOutliers(data);
    expect(rows.length).toBe(1);
    expect(rows[0].symbol).toBe('2222');
  });
});
