import { describe, expect, it } from 'vitest';
import { formatUnknownError } from '../utils/formatUnknownError';

describe('formatUnknownError', () => {
  it('prefers Error.message', () => {
    expect(formatUnknownError(new Error('Insufficient cash'))).toBe('Insufficient cash');
  });

  it('formats Supabase-style objects instead of [object Object]', () => {
    expect(
      formatUnknownError({
        message: 'insert or update on table "investment_transactions" violates foreign key constraint',
        code: '23503',
        details: 'Key (account_id)=(x) is not present in table "accounts".',
        hint: null,
      }),
    ).toMatch(/foreign key/i);
    expect(formatUnknownError({ message: 'boom', code: '42501' })).toContain('boom');
  });

  it('never returns the useless [object Object] string', () => {
    expect(formatUnknownError({})).not.toBe('[object Object]');
    expect(formatUnknownError({ message: { nested: true } })).not.toBe('[object Object]');
  });
});
