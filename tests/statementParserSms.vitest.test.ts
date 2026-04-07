import { describe, expect, it } from 'vitest';
import { extractTransactionsFromSMS } from '../services/statementParser';

describe('extractTransactionsFromSMS', () => {
  it('parses Arabic-indic digits and debit wording', () => {
    const sms = 'الراجحي: SAR ١٢٣٫٤٥ debited from A/C *1234 on 06/04/2026';
    const out = extractTransactionsFromSMS(sms, 'acc-1');
    expect(out.length).toBe(1);
    expect(out[0].amount).toBeLessThan(0);
    expect(Math.abs(out[0].amount)).toBeCloseTo(123.45, 2);
    expect(out[0].accountId).toBe('acc-1');
  });

  it('uses fallback parser for generic SMS lines with SAR/SR', () => {
    const sms = 'Purchase at Jarir SR 250 on 06-04-2026';
    const out = extractTransactionsFromSMS(sms, 'acc-2');
    expect(out.length).toBe(1);
    expect(out[0].amount).toBe(-250);
    expect(out[0].type).toBe('expense');
  });
});

