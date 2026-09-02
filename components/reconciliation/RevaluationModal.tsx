import React, { useEffect, useMemo, useState } from 'react';
import Modal from '../Modal';
import {
  isValidReason,
  previewRevaluation,
  previewSukukPrincipalRestatement,
  type ReconciliationPreview,
} from '../../services/reconciliation';

export type RevaluationEntityType = 'asset' | 'commodity' | 'liability' | 'sukuk_position';

export interface RevaluationModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  entityType: RevaluationEntityType;
  entityId: string;
  entityLabel: string;
  beforeValue: number;
  currency?: 'SAR' | 'USD';
  /** Sukuk only: outstanding principal may not exceed face value. */
  maxValue?: number;
  onApply: (args: {
    entityType: RevaluationEntityType;
    entityId: string;
    actualValue: number;
    reason: string;
  }) => Promise<void>;
}

const RevaluationModal: React.FC<RevaluationModalProps> = ({
  isOpen,
  onClose,
  title,
  entityType,
  entityId,
  entityLabel,
  beforeValue,
  currency = 'SAR',
  maxValue,
  onApply,
}) => {
  const [actualStr, setActualStr] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setActualStr(String(beforeValue ?? ''));
    setReason('');
    setError(null);
  }, [isOpen, beforeValue]);

  const preview: ReconciliationPreview | null = useMemo(() => {
    const actual = Number(String(actualStr).replace(/,/g, ''));
    if (!Number.isFinite(actual)) return null;
    if (entityType === 'sukuk_position') {
      return previewSukukPrincipalRestatement({
        positionId: entityId,
        beforeValue,
        actualValue: actual,
        faceValue: maxValue,
        currency,
        reason,
      });
    }
    return previewRevaluation({
      entityType,
      entityId,
      beforeValue,
      actualValue: actual,
      currency,
      reason,
    });
  }, [entityType, entityId, beforeValue, actualStr, currency, maxValue, reason]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isValidReason(reason)) {
      setError('Reason is required (at least 3 characters).');
      return;
    }
    const actual = Number(String(actualStr).replace(/,/g, ''));
    if (!Number.isFinite(actual)) {
      setError('Enter a valid value.');
      return;
    }
    if (preview?.blockedReason) {
      setError(preview.blockedReason);
      return;
    }
    if (preview?.noop) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      await onApply({ entityType, entityId, actualValue: actual, reason });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-slate-600">
          {entityLabel}:{' '}
          {entityType === 'sukuk_position'
            ? 'correcting the outstanding balance updates Sukuk exposure and net worth. Posted payouts stay; only unposted future payouts are rebuilt.'
            : 'revaluation updates net worth only — no cash transaction is created.'}
        </p>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm tabular-nums flex justify-between">
          <span className="text-slate-600">Current book</span>
          <span className="font-medium">
            {Number(beforeValue).toFixed(2)} {currency}
          </span>
        </div>
        {preview && (
          <div className="text-sm tabular-nums flex justify-between px-1">
            <span className="text-slate-600">Delta</span>
            <span>
              {preview.delta >= 0 ? '+' : ''}
              {preview.delta.toFixed(2)} {currency}
            </span>
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">New value ({currency})</label>
          <input
            type="number"
            step="any"
            className="input-base"
            value={actualStr}
            onChange={(e) => setActualStr(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Reason (required)</label>
          <input
            type="text"
            className="input-base"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Annual appraisal"
            required
            minLength={3}
          />
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex gap-2">
          <button type="button" className="btn-outline flex-1" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn-primary flex-1" disabled={busy || Boolean(preview?.noop)}>
            {busy ? 'Applying…' : preview?.noop ? 'Already matches' : 'Apply revaluation'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default RevaluationModal;
