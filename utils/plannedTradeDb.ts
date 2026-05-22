import type { PlannedTrade } from '../types';

/** Normalize API row (snake_case + camelCase) to app `PlannedTrade` shape. */
export function normalizePlannedTradeRow(row: unknown): PlannedTrade {
  const r = row as Record<string, unknown>;
  if (!r || typeof r !== 'object') return row as PlannedTrade;
  const portfolioRaw = r.portfolioId ?? r.portfolio_id;
  const accountRaw = r.accountId ?? r.account_id;
  const portfolioId =
    portfolioRaw != null && String(portfolioRaw).trim() !== '' ? String(portfolioRaw).trim() : undefined;
  const accountId =
    accountRaw != null && String(accountRaw).trim() !== '' ? String(accountRaw).trim() : undefined;
  return {
    ...(r as unknown as PlannedTrade),
    portfolioId,
    accountId,
    trancheIndex: r.tranche_index != null ? Number(r.tranche_index) : r.trancheIndex != null ? Number(r.trancheIndex) : undefined,
    trancheGroupId: (r.tranche_group_id ?? r.trancheGroupId) != null ? String(r.tranche_group_id ?? r.trancheGroupId) : undefined,
    filledQty: r.filled_qty != null ? Number(r.filled_qty) : r.filledQty != null ? Number(r.filledQty) : undefined,
    targetQty: r.target_qty != null ? Number(r.target_qty) : r.targetQty != null ? Number(r.targetQty) : undefined,
  };
}

function trancheDbFields(plan: Pick<PlannedTrade, 'trancheIndex' | 'trancheGroupId' | 'filledQty' | 'targetQty'>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (plan.trancheIndex != null) out.tranche_index = plan.trancheIndex;
  if (plan.trancheGroupId) out.tranche_group_id = plan.trancheGroupId;
  if (plan.filledQty != null) out.filled_qty = plan.filledQty;
  if (plan.targetQty != null) out.target_qty = plan.targetQty;
  return out;
}

/** Insert payload: snake_case venue columns for Postgres; omit empty venue on create. */
export function plannedTradeToDbInsert(plan: Omit<PlannedTrade, 'id' | 'user_id'>): Record<string, unknown> {
  const p = plan as unknown as Record<string, unknown>;
  const portfolio_id =
    plan.portfolioId != null && String(plan.portfolioId).trim() ? String(plan.portfolioId).trim() : undefined;
  const account_id =
    plan.accountId != null && String(plan.accountId).trim() ? String(plan.accountId).trim() : undefined;
  const { portfolioId: _pid, accountId: _aid, portfolio_id: _p_snake, account_id: _a_snake, ...rest } = p as Record<
    string,
    unknown
  >;
  const out: Record<string, unknown> = { ...rest };
  if (portfolio_id) out.portfolio_id = portfolio_id;
  if (account_id) out.account_id = account_id;
  return { ...out, ...trancheDbFields(plan) };
}

/** Full row update including nullable venue clears. */
export function plannedTradeToDbUpdate(plan: PlannedTrade): Record<string, unknown> {
  const portfolio_id =
    plan.portfolioId != null && String(plan.portfolioId).trim() ? String(plan.portfolioId).trim() : null;
  const account_id = plan.accountId != null && String(plan.accountId).trim() ? String(plan.accountId).trim() : null;
  const p = plan as unknown as Record<string, unknown>;
  const { portfolioId: _pid, accountId: _aid, portfolio_id: _p_snake, account_id: _a_snake, ...rest } = p;
  return { ...rest, portfolio_id, account_id, ...trancheDbFields(plan) };
}
