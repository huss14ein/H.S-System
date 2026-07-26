import { roundMoney } from '../../utils/money';
import { normalizeReason } from './constants';
import type { ReconciliationMechanism } from './constants';

/** Stable hash of reason for idempotency (not cryptographic). */
export function reasonHash(reason: string): string {
  const s = normalizeReason(reason);
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}

export function buildIdempotencyKey(args: {
  userId: string;
  entityType: string;
  entityId: string;
  effectiveDate: string;
  mechanism: ReconciliationMechanism | string;
  delta: number;
  reason: string;
  clientNonce?: string;
}): string {
  const rounded = roundMoney(Number(args.delta) || 0).toFixed(4);
  const parts = [
    args.userId,
    args.entityType,
    args.entityId,
    args.effectiveDate.slice(0, 10),
    args.mechanism,
    rounded,
    reasonHash(args.reason),
  ];
  if (args.clientNonce) parts.push(String(args.clientNonce));
  return parts.join('|');
}
