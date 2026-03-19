/**
 * Behavioral finance controls (logic layer).
 *
 * Prevents some common traps by gating trade actions based on liquidity,
 * cooldown, and recent drawdown patterns.
 */

export interface BehavioralContext {
  /** months of cash runway */
  runwayMonths: number;
  /** emergency fund months */
  emergencyFundMonths: number;
  /** optional last trade timestamps */
  lastTradeAtISO?: string | null;
  /** optional last loss timestamp and drawdown */
  lastLossAtISO?: string | null;
  recentDrawdownPct?: number;
}

export interface TradeRequest {
  type: 'buy' | 'sell';
  isSpeculative?: boolean;
}

export function behavioralRiskCheck(args: {
  request: TradeRequest;
  ctx: BehavioralContext;
  /** If cashflow is negative, disallow new buys unless override. */
  allowTradeWhenCashflowNegative?: boolean;
  /** If speculative, allow only from dedicated speculative capital (handled by policy). */
  speculativeCapitalOk?: boolean;
}): { allowed: boolean; flags: string[] } {
  const flags: string[] = [];
  const ctx = args.ctx;

  if (args.request.type === 'buy') {
    if ((ctx.runwayMonths ?? 0) < 1 || (ctx.emergencyFundMonths ?? 0) < 1) {
      flags.push('cash runway/emergency fund too low');
    }
  }

  if (args.request.isSpeculative && !args.speculativeCapitalOk) {
    flags.push('speculative trade not backed by dedicated capital');
  }

  if (flags.length > 0) return { allowed: false, flags };
  return { allowed: true, flags: [] };
}

export function enforceTradeCooldown(args: {
  /** If last trade was within this cooldown window, block. */
  cooldownDays: number;
  nowISO?: string;
  lastTradeAtISO?: string | null;
}): { allowed: boolean; remainingDays: number } {
  const cooldownDays = Math.max(0, Number(args.cooldownDays) || 0);
  const now = args.nowISO ? new Date(args.nowISO) : new Date();
  const last = args.lastTradeAtISO ? new Date(args.lastTradeAtISO) : null;
  if (!last || cooldownDays <= 0) return { allowed: true, remainingDays: 0 };

  const diffDays = (now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24);
  const remainingDays = Math.max(0, cooldownDays - diffDays);
  return { allowed: remainingDays <= 0, remainingDays };
}

export function preventEmotionDrivenTrade(args: {
  /** If true, user recently experienced a drawdown spike; block unless override. */
  requireApprovalIfRecentDrawdownPctAbove?: number;
  recentDrawdownPct?: number;
  override?: boolean;
}): { allowed: boolean; reason?: string } {
  const threshold = args.requireApprovalIfRecentDrawdownPctAbove ?? 10;
  const dd = Number.isFinite(args.recentDrawdownPct) ? (args.recentDrawdownPct as number) : 0;
  if (args.override) return { allowed: true };
  if (dd >= threshold) {
    return { allowed: false, reason: `Recent drawdown ${dd.toFixed(1)}% is above ${threshold}%. Consider review instead of immediate action.` };
  }
  return { allowed: true };
}

