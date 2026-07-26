/**
 * Standard fixed-rate loan amortization (declining balance).
 * Pure math — no persistence. Used for debt payoff schedules and installment plans.
 */
import { roundMoney } from '../utils/money';

export interface AmortizationRow {
  /** 1-based payment number. */
  period: number;
  payment: number;
  interest: number;
  principal: number;
  /** Remaining balance after this payment. */
  balance: number;
}

export interface AmortizationSchedule {
  monthlyPayment: number;
  totalInterest: number;
  totalPaid: number;
  rows: AmortizationRow[];
}

/**
 * Level monthly payment for a loan: P·r / (1 − (1+r)^−n).
 * Handles the zero-interest case (payment = principal / months).
 */
export function computeLevelMonthlyPayment(principal: number, aprAnnual: number, months: number): number {
  const P = Math.max(0, Number(principal) || 0);
  const n = Math.max(1, Math.floor(Number(months) || 0));
  const r = Math.max(0, Number(aprAnnual) || 0) / 12;
  if (P <= 0) return 0;
  if (r === 0) return P / n;
  return (P * r) / (1 - Math.pow(1 + r, -n));
}

export function buildAmortizationSchedule(args: {
  principal: number;
  aprAnnual: number;
  months: number;
}): AmortizationSchedule {
  const P = Math.max(0, Number(args.principal) || 0);
  /** Hard cap avoids UI freezes from pathological maturity dates. */
  const n = Math.max(1, Math.min(600, Math.floor(Number(args.months) || 0)));
  const r = Math.max(0, Number(args.aprAnnual) || 0) / 12;
  const rawPayment = computeLevelMonthlyPayment(P, args.aprAnnual, n);
  const monthlyPayment = roundMoney(rawPayment);

  const rows: AmortizationRow[] = [];
  let balance = P;
  let totalInterest = 0;
  let totalPaid = 0;

  for (let period = 1; period <= n; period++) {
    const interest = roundMoney(balance * r);
    // Final payment clears any residual rounding so the balance lands exactly on 0.
    let principalPortion = period === n ? balance : roundMoney(rawPayment - interest);
    if (principalPortion > balance) principalPortion = balance;
    const payment = roundMoney(principalPortion + interest);
    balance = roundMoney(balance - principalPortion);
    totalInterest = roundMoney(totalInterest + interest);
    totalPaid = roundMoney(totalPaid + payment);
    rows.push({ period, payment, interest, principal: principalPortion, balance: Math.max(0, balance) });
  }

  return {
    monthlyPayment,
    totalInterest,
    totalPaid,
    rows,
  };
}
