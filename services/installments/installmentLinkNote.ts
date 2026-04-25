const NOTE_RE = /\[InstallmentPayment:\s*installmentId=([0-9a-fA-F-]{36})\s*\]/;

export function encodeInstallmentPaymentNote(baseNote: string | undefined, installmentId: string): string {
  const clean = String(baseNote ?? '').trim();
  const tag = `[InstallmentPayment:installmentId=${installmentId}]`;
  if (!clean) return tag;
  if (NOTE_RE.test(clean)) return clean; // already linked
  return `${clean}\n${tag}`;
}

export function decodeInstallmentPaymentNote(note: string | undefined | null): { installmentId: string } | null {
  const m = String(note ?? '').match(NOTE_RE);
  if (!m) return null;
  return { installmentId: m[1] };
}

