import React, { useEffect, useMemo, useState } from 'react';
import Modal from '../Modal';
import { isValidReason, previewHoldingQuantityReconcile } from '../../services/reconciliation';

export interface ReconcileQuantityModalProps {
  isOpen: boolean;
  onClose: () => void;
  holdingId: string;
  symbol: string;
  beforeQty: number;
  onApply: (args: {
    holdingId: string;
    actualQty: number;
    costBasisTotal?: number;
    reason: string;
  }) => Promise<void>;
}

const ReconcileQuantityModal: React.FC<ReconcileQuantityModalProps> = ({
  isOpen,
  onClose,
  holdingId,
  symbol,
  beforeQty,
  onApply,
}) => {
  const [qtyStr, setQtyStr] = useState('');
  const [costStr, setCostStr] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setQtyStr(String(beforeQty ?? ''));
    setCostStr('');
    setReason('');
    setError(null);
  }, [isOpen, beforeQty]);

  const actualQty = Number(String(qtyStr).replace(/,/g, ''));
  const costBasisTotal = costStr.trim() === '' ? undefined : Number(String(costStr).replace(/,/g, ''));
  const preview = useMemo(() => {
    if (!Number.isFinite(actualQty)) return null;
    return previewHoldingQuantityReconcile({
      holdingId,
      beforeQty,
      actualQty,
      costBasisTotal,
      reason,
    });
  }, [holdingId, beforeQty, actualQty, costBasisTotal, reason]);

  const needsCost = Number.isFinite(actualQty) && actualQty > beforeQty;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isValidReason(reason)) {
      setError('Reason is required (at least 3 characters).');
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
      await onApply({
        holdingId,
        actualQty,
        costBasisTotal: needsCost ? costBasisTotal : undefined,
        reason,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Reconcile quantity — ${symbol}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-slate-600">
          Match shares to your broker statement. Market prices are not changed. Increasing quantity requires total cost
          for the added shares.
        </p>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm tabular-nums flex justify-between">
          <span className="text-slate-600">Book quantity</span>
          <span className="font-medium">{beforeQty}</span>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Actual shares</label>
          <input
            type="number"
            step="any"
            className="input-base"
            value={qtyStr}
            onChange={(e) => setQtyStr(e.target.value)}
            required
          />
        </div>
        {needsCost && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Total cost for added shares (required)
            </label>
            <input
              type="number"
              step="any"
              className="input-base"
              value={costStr}
              onChange={(e) => setCostStr(e.target.value)}
              required
            />
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Reason (required)</label>
          <input
            type="text"
            className="input-base"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Match broker statement qty"
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
            {busy ? 'Applying…' : 'Apply quantity reconcile'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default ReconcileQuantityModal;
