export type InstallmentProvider = 'MANUAL' | 'OTHER';
export type InstallmentPlanStatus = 'PENDING_ACTIVATION' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'DEFAULTED';
export type InstallmentStatus =
  | 'SCHEDULED'
  | 'DUE'
  | 'PROCESSING'
  | 'PAID'
  | 'FAILED'
  | 'WAIVED'
  | 'REFUNDED'
  | 'CANCELLED';

export type PaymentEventProcessingStatus = 'RECEIVED' | 'PROCESSED' | 'IGNORED' | 'FAILED_RETRYABLE' | 'FAILED_FINAL';

export type PaymentEventType =
  | 'CHECKOUT_CREATED'
  | 'PLAN_AUTHORIZED'
  | 'PLAN_REJECTED'
  | 'PLAN_ACTIVATED'
  | 'INSTALLMENT_DUE'
  | 'PAYMENT_CAPTURED'
  | 'PAYMENT_FAILED'
  | 'REFUND_COMPLETED'
  | 'PLAN_CANCELLED';

export type PlanSnapshot = {
  planId: string;
  provider: InstallmentProvider;
  status: InstallmentPlanStatus;
  totalAmountMinor: bigint;
  installmentCount: number;
  paidCount: number;
};

export type InstallmentSnapshot = {
  installmentId: string;
  sequence: number;
  status: InstallmentStatus;
  amountMinor: bigint;
};

export type ReducerState = {
  plan: PlanSnapshot;
  installmentsBySeq: Map<number, InstallmentSnapshot>;
};

export type ReducerEvent = {
  type: PaymentEventType;
  atISO: string;
  providerRef?: string | null;
  installmentSequence?: number | null;
};

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function isTerminalPlanStatus(s: InstallmentPlanStatus): boolean {
  return s === 'COMPLETED' || s === 'CANCELLED' || s === 'DEFAULTED';
}

function isTerminalInstallmentStatus(s: InstallmentStatus): boolean {
  return s === 'PAID' || s === 'REFUNDED' || s === 'WAIVED' || s === 'CANCELLED';
}

/**
 * Pure reducer: applies a payment event to in-memory state.
 * Use in server processing to validate transitions before persisting.
 */
export function applyInstallmentEvent(state: ReducerState, ev: ReducerEvent): ReducerState {
  if (isTerminalPlanStatus(state.plan.status)) {
    // Terminal plan: ignore anything except refunds (which might arrive late)
    if (ev.type !== 'REFUND_COMPLETED') return state;
  }

  const next: ReducerState = {
    plan: { ...state.plan },
    installmentsBySeq: new Map(state.installmentsBySeq),
  };

  const seq = ev.installmentSequence == null ? null : Math.trunc(ev.installmentSequence);
  const getInst = () => {
    assert(seq != null && seq >= 1 && seq <= next.plan.installmentCount, 'invalid installmentSequence');
    const inst = next.installmentsBySeq.get(seq);
    assert(inst, `missing installment for sequence ${seq}`);
    return inst;
  };

  switch (ev.type) {
    case 'CHECKOUT_CREATED':
      // no-op for status; stored for audit
      return next;
    case 'PLAN_AUTHORIZED':
      if (next.plan.status === 'PENDING_ACTIVATION') next.plan.status = 'ACTIVE';
      return next;
    case 'PLAN_ACTIVATED':
      if (next.plan.status === 'PENDING_ACTIVATION') next.plan.status = 'ACTIVE';
      return next;
    case 'PLAN_REJECTED':
      if (next.plan.status === 'PENDING_ACTIVATION') next.plan.status = 'CANCELLED';
      return next;
    case 'PLAN_CANCELLED':
      if (!isTerminalPlanStatus(next.plan.status)) next.plan.status = 'CANCELLED';
      return next;
    case 'INSTALLMENT_DUE': {
      const inst = getInst();
      if (isTerminalInstallmentStatus(inst.status)) return next;
      if (inst.status === 'SCHEDULED') {
        next.installmentsBySeq.set(inst.sequence, { ...inst, status: 'DUE' });
      }
      return next;
    }
    case 'PAYMENT_CAPTURED': {
      const inst = getInst();
      if (inst.status === 'PAID') return next;
      if (isTerminalInstallmentStatus(inst.status)) return next;
      next.installmentsBySeq.set(inst.sequence, { ...inst, status: 'PAID' });
      next.plan.paidCount = Math.min(next.plan.installmentCount, next.plan.paidCount + 1);
      if (next.plan.paidCount >= next.plan.installmentCount) next.plan.status = 'COMPLETED';
      return next;
    }
    case 'PAYMENT_FAILED': {
      const inst = getInst();
      if (isTerminalInstallmentStatus(inst.status)) return next;
      next.installmentsBySeq.set(inst.sequence, { ...inst, status: 'FAILED' });
      return next;
    }
    case 'REFUND_COMPLETED': {
      const inst = getInst();
      // allow refund even after terminal plan
      if (inst.status === 'REFUNDED') return next;
      next.installmentsBySeq.set(inst.sequence, { ...inst, status: 'REFUNDED' });
      // do not auto-reopen plan; reconciliation decides if plan should change
      return next;
    }
    default: {
      const _exhaustive: never = ev.type;
      return _exhaustive;
    }
  }
}

