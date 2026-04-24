import { describe, expect, it } from 'vitest';
import { decodeInstallmentPaymentNote, encodeInstallmentPaymentNote } from '../services/installments/installmentLinkNote';

describe('installmentLinkNote', () => {
  it('encodes a tag when note is empty', () => {
    const out = encodeInstallmentPaymentNote('', '11111111-1111-1111-1111-111111111111');
    expect(out).toContain('InstallmentPayment:installmentId=11111111-1111-1111-1111-111111111111');
  });

  it('appends tag when note exists', () => {
    const out = encodeInstallmentPaymentNote('hello', '22222222-2222-2222-2222-222222222222');
    expect(out.startsWith('hello')).toBe(true);
    expect(out).toContain('InstallmentPayment:installmentId=22222222-2222-2222-2222-222222222222');
  });

  it('decodes installment id', () => {
    const note = 'x\n[InstallmentPayment:installmentId=33333333-3333-3333-3333-333333333333]';
    expect(decodeInstallmentPaymentNote(note)).toEqual({ installmentId: '33333333-3333-3333-3333-333333333333' });
  });

  it('returns null when missing', () => {
    expect(decodeInstallmentPaymentNote('nope')).toBeNull();
  });
});

