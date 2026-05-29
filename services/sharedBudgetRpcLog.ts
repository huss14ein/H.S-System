let sharedBudgetRpcErrorLogged = false;

export function logSharedBudgetRpcFailureOnce(error: unknown): void {
  if (sharedBudgetRpcErrorLogged) return;
  sharedBudgetRpcErrorLogged = true;
  console.warn('[Budgets] get_shared_budget_consumed_for_me failed — apply migration 20260527120000_fix_shared_budget_consumed_date_trim.sql', error);
}

export function resetSharedBudgetRpcErrorLogForTests(): void {
  sharedBudgetRpcErrorLogged = false;
}
