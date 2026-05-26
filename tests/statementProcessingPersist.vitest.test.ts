import { describe, expect, it } from 'vitest';
import {
  buildStatementUpsertRow,
  isStatementUuid,
  shouldPersistStatementsAfterHydrate,
  STATEMENT_LIST_SELECT,
} from '../services/statementPersistence';

describe('statementProcessingPersist', () => {
  it('does not persist before hydrate completes', () => {
    expect(shouldPersistStatementsAfterHydrate(false, 10)).toBe(false);
    expect(shouldPersistStatementsAfterHydrate(true, 0)).toBe(false);
  });

  it('allows localStorage backup after hydrate when statements exist', () => {
    expect(shouldPersistStatementsAfterHydrate(true, 3)).toBe(true);
  });

  it('list select omits extracted_transactions join', () => {
    expect(STATEMENT_LIST_SELECT).not.toContain('extracted_transactions');
  });

  it('buildStatementUpsertRow can omit updated_at on read-back', () => {
    const row = buildStatementUpsertRow(
      {
        id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        fileName: 'stmt.pdf',
        fileType: 'pdf',
        fileSize: 100,
        uploadedAt: new Date('2024-06-01T00:00:00Z'),
        status: 'completed',
        statementPeriod: {
          startDate: new Date('2024-05-01'),
          endDate: new Date('2024-05-31'),
        },
        openingBalance: 0,
        closingBalance: 100,
        confidence: 1,
        summary: {},
      },
      'user-1',
      { touchUpdatedAt: false },
    );
    expect(row.updated_at).toBeUndefined();
    expect(row.user_id).toBe('user-1');
  });

  it('isStatementUuid validates uuid format', () => {
    expect(isStatementUuid('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe(true);
    expect(isStatementUuid('local-temp-id')).toBe(false);
  });
});
