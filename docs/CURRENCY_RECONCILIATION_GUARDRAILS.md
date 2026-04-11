# Currency Reconciliation Guardrails (Investments)

This project enforces the following rules for investment cash/KPI correctness:

1. **Ledger cash is bucketed by transaction currency (`SAR` / `USD`) per investment account.**
2. **Trade totals are posted to their own currency bucket** (e.g., USD buy reduces USD cash, not SAR cash).
3. **KPI display conversion happens only at read/report time** using configured FX (`sarPerUsd`).
4. **Legacy fallback to `accounts.balance` is allowed only when an account has zero investment ledger rows.**
5. **Platform KPI reconciliation identities must hold**:
   - `netCapitalSAR = max(0, totalInvestedSAR - totalWithdrawnSAR)`
   - `totalGainLossSAR = totalValueInSAR - netCapitalSAR`

## Automated checks

- `tests/investmentCashLedger.vitest.test.ts`
- `tests/investmentCurrencyEndToEnd.vitest.test.ts`
- `tests/investmentLedgerCurrency.vitest.test.ts`
- `tests/investmentSarFlowMetrics.vitest.test.ts`

Run:

```bash
npm run test:unit -- tests/investmentCashLedger.vitest.test.ts tests/investmentCurrencyEndToEnd.vitest.test.ts tests/investmentLedgerCurrency.vitest.test.ts tests/investmentSarFlowMetrics.vitest.test.ts
```
