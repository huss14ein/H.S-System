import type { SukukPosition } from '../../types';
import { roundMoney } from '../../utils/money';

export function normalizeSukukPositionRow(raw: any): SukukPosition {
  if (!raw || typeof raw !== 'object') {
    return {
      id: '',
      name: '',
      investmentAccountId: '',
      currency: 'SAR',
      faceValue: 0,
      outstandingPrincipal: 0,
      issueDate: '',
      maturityDate: '',
      status: 'active',
    };
  }
  const statusRaw = String(raw.status ?? 'active').toLowerCase();
  return {
    id: String(raw.id ?? ''),
    user_id: raw.user_id ?? raw.userId,
    name: String(raw.name ?? ''),
    investmentAccountId: String(raw.investment_account_id ?? raw.investmentAccountId ?? ''),
    currency: raw.currency === 'USD' ? 'USD' : 'SAR',
    faceValue: roundMoney(Number(raw.face_value ?? raw.faceValue ?? 0)),
    outstandingPrincipal: roundMoney(Number(raw.outstanding_principal ?? raw.outstandingPrincipal ?? 0)),
    purchasePrice:
      raw.purchase_price != null || raw.purchasePrice != null
        ? roundMoney(Number(raw.purchase_price ?? raw.purchasePrice))
        : null,
    issueDate: String(raw.issue_date ?? raw.issueDate ?? '').slice(0, 10),
    maturityDate: String(raw.maturity_date ?? raw.maturityDate ?? '').slice(0, 10),
    status: statusRaw === 'completed' ? 'completed' : 'active',
    goalId: raw.goal_id ?? raw.goalId ?? null,
    notes: raw.notes != null ? String(raw.notes) : null,
    metadata: (raw.metadata ?? {}) as Record<string, unknown>,
    createdAt: raw.created_at ?? raw.createdAt,
    updatedAt: raw.updated_at ?? raw.updatedAt,
  };
}

export function sukukPositionToRow(
  position: Partial<SukukPosition> & {
    name: string;
    investmentAccountId: string;
    faceValue: number;
    outstandingPrincipal: number;
    issueDate: string;
    maturityDate: string;
  },
): Record<string, unknown> {
  return {
    name: position.name,
    investment_account_id: position.investmentAccountId,
    currency: position.currency === 'USD' ? 'USD' : 'SAR',
    face_value: roundMoney(position.faceValue),
    outstanding_principal: roundMoney(position.outstandingPrincipal),
    purchase_price:
      position.purchasePrice != null && Number(position.purchasePrice) > 0
        ? roundMoney(Number(position.purchasePrice))
        : null,
    issue_date: String(position.issueDate).slice(0, 10),
    maturity_date: String(position.maturityDate).slice(0, 10),
    status: position.status === 'completed' ? 'completed' : 'active',
    goal_id: position.goalId ?? null,
    notes: position.notes ?? null,
    metadata: position.metadata ?? {},
  };
}
