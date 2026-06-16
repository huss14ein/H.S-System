import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('transaction budget submit wiring', () => {
  const transactionsSource = fs.readFileSync(
    path.join(process.cwd(), 'pages/Transactions.tsx'),
    'utf8',
  );

  it('uses warn-only budget submit helpers in TransactionModal', () => {
    expect(transactionsSource).toContain('getTransactionBudgetSubmitBlockReason');
    expect(transactionsSource).toContain('buildTransactionBudgetConfirmWarning');
    expect(transactionsSource).toMatch(/You can still save/i);
  });

  it('does not hard-stop on budget shortfall in handleSubmit', () => {
    expect(transactionsSource).not.toContain('Selected budget cannot cover');
    expect(transactionsSource).not.toContain('Split allocation exceeds remaining budget limits');
    expect(transactionsSource).not.toContain('canSubmitWithCurrentBudgetCoverage');
  });
});
