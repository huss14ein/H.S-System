import React, { useEffect, useMemo, useState } from 'react';
import Modal from '../Modal';
import { isValidReason, previewHoldingQuantityReconcile } from '../../services/reconciliation';
import { roundMoney, roundQuantity } from '../../utils/money';

export interface ReconcileQuantityModalProps {
  isOpen: boolean;
  onClose: () => void;
  holdingId: string;
  symbol: string;
  beforeQty: number;
  /** Current WAC average cost (portfolio book currency). */
  beforeAvgCost?: number;
  bookCurrency?: 'SAR' | 'USD';
  onApply: (args: {
    holdingId: string;
    actualQty: number;
    costBasisTotal?: number;
    targetAvgCost?: number;
    targetBookCost?: number;
    alignLotCostsToBook?: boolean;
    reason: string;
  }) => Promise<void>;
}

function parseOptionalNumber(raw: string): number | undefined {
  const trimmed = String(raw ?? '').trim();
  if (trimmed === '') return undefined;
  const n = Number(trimmed.replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

const ReconcileQuantityModal: React.FC<ReconcileQuantityModalProps> = ({
  isOpen,
  onClose,
  holdingId,
  symbol,
  beforeQty,
  beforeAvgCost = 0,
  bookCurrency = 'USD',
  onApply,
}) => {
  const [qtyStr, setQtyStr] = useState('');
  const [avgStr, setAvgStr] = useState('');
  const [bookStr, setBookStr] = useState('');
  const [addCostStr, setAddCostStr] = useState('');
  /** Only user edits of avg/book are sent as restatements — qty-driven preview must not. */
  const [avgDirty, setAvgDirty] = useState(false);
  const [bookDirty, setBookDirty] = useState(false);
  const [alignLotCosts, setAlignLotCosts] = useState(true);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const beforeBook = roundMoney((Number(beforeAvgCost) || 0) * (Number(beforeQty) || 0));

  useEffect(() => {
    if (!isOpen) return;
    setQtyStr(String(beforeQty ?? ''));
    setAvgStr(String(beforeAvgCost ?? ''));
    setBookStr(String(beforeBook || ''));
    setAddCostStr('');
    setAvgDirty(false);
    setBookDirty(false);
    setAlignLotCosts(true);
    setReason('');
    setError(null);
  }, [isOpen, beforeQty, beforeAvgCost, beforeBook]);

  const actualQtyRaw = parseOptionalNumber(qtyStr);
  const actualQty = actualQtyRaw != null ? roundQuantity(actualQtyRaw) : NaN;
  const parsedAvg = parseOptionalNumber(avgStr);
  const parsedBook = parseOptionalNumber(bookStr);
  const parsedAddCost = parseOptionalNumber(addCostStr);
  const qtyUp = Number.isFinite(actualQty) && actualQty > beforeQty;

  /** Restatement fields only when the user edited them — never auto-derived proportional book. */
  const targetBookCost = bookDirty && parsedBook != null && parsedBook >= 0 ? roundMoney(parsedBook) : undefined;
  const targetAvgCost =
    !bookDirty && avgDirty && parsedAvg != null && parsedAvg >= 0
      ? Number(parsedAvg)
      : undefined;
  const costBasisTotal =
    qtyUp && parsedAddCost != null && parsedAddCost >= 0 ? roundMoney(parsedAddCost) : undefined;

  const preview = useMemo(() => {
    if (!Number.isFinite(actualQty)) return null;
    return previewHoldingQuantityReconcile({
      holdingId,
      beforeQty,
      actualQty,
      costBasisTotal,
      targetBookCost,
      targetAvgCost,
      beforeAvgCost,
      alignLotCostsToBook: alignLotCosts,
      reason,
    });
  }, [
    holdingId,
    beforeQty,
    actualQty,
    costBasisTotal,
    targetBookCost,
    targetAvgCost,
    beforeAvgCost,
    alignLotCosts,
    reason,
  ]);

  const handleQtyChange = (raw: string) => {
    setQtyStr(raw);
    const q = parseOptionalNumber(raw);
    if (q == null || q < 0) return;
    // Preview-only book line from current avg — does not mark book dirty / does not restate cost.
    if (!bookDirty) {
      const avgFromField = parseOptionalNumber(avgStr);
      const avg = avgDirty && avgFromField != null ? avgFromField : Number(beforeAvgCost) || 0;
      if (Number.isFinite(avg) && avg >= 0) {
        setBookStr(String(roundMoney(avg * q)));
      }
    }
  };

  const handleAvgChange = (raw: string) => {
    setAvgStr(raw);
    setAvgDirty(true);
    setBookDirty(false);
    const avg = parseOptionalNumber(raw);
    const q = parseOptionalNumber(qtyStr);
    if (avg != null && avg >= 0 && q != null && q >= 0) {
      setBookStr(String(roundMoney(avg * q)));
    }
  };

  const handleBookChange = (raw: string) => {
    setBookStr(raw);
    setBookDirty(true);
    setAvgDirty(false);
    const book = parseOptionalNumber(raw);
    const q = parseOptionalNumber(qtyStr);
    if (book != null && book >= 0 && q != null && q > 0) {
      setAvgStr(String(Number((book / q).toFixed(6))));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isValidReason(reason)) {
      setError('Reason is required (at least 3 characters).');
      return;
    }
    if (!Number.isFinite(actualQty) || actualQty < 0) {
      setError('Enter a valid actual share quantity.');
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
        costBasisTotal,
        targetBookCost,
        targetAvgCost,
        alignLotCostsToBook: alignLotCosts,
        reason,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const ccy = bookCurrency === 'SAR' ? 'SAR' : 'USD';
  const derivedBookHint =
    Number.isFinite(actualQty) && actualQty >= 0
      ? roundMoney((avgDirty && parsedAvg != null ? parsedAvg : Number(beforeAvgCost) || 0) * actualQty)
      : beforeBook;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Reconcile holding — ${symbol}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-slate-600">
          Match quantity and cost basis to your broker statement. Market prices are not changed. This is a{' '}
          <strong>non-cash book correction</strong> — reducing shares does <strong>not</strong> post a sell or
          withdrawal, so Invested / Withdrawn and cashflow KPIs stay unchanged. Open lots are trimmed FIFO when
          quantity decreases; restating average / book cost realigns lot costs when enabled below.
        </p>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm tabular-nums space-y-1">
          <div className="flex justify-between gap-2">
            <span className="text-slate-600">Book quantity</span>
            <span className="font-medium">{beforeQty}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-slate-600">Book avg. cost</span>
            <span className="font-medium">
              {Number(beforeAvgCost || 0).toFixed(4)} {ccy}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-slate-600">Book cost basis</span>
            <span className="font-medium">
              {beforeBook.toFixed(2)} {ccy}
            </span>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Actual shares</label>
          <input
            type="number"
            step="any"
            className="input-base"
            value={qtyStr}
            onChange={(e) => handleQtyChange(e.target.value)}
            required
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Average cost ({ccy})</label>
            <input
              type="number"
              step="any"
              className="input-base"
              value={avgStr}
              onChange={(e) => handleAvgChange(e.target.value)}
            />
            <p className="text-xs text-slate-500 mt-1">
              Edit only to restate WAC. Qty-only changes keep the current average.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Total cost basis ({ccy})</label>
            <input
              type="number"
              step="any"
              className="input-base"
              value={bookStr}
              onChange={(e) => handleBookChange(e.target.value)}
            />
            <p className="text-xs text-slate-500 mt-1">
              {bookDirty
                ? 'Will restate the full book cost to this amount.'
                : `Preview (${derivedBookHint.toFixed(2)} ${ccy}) — not applied unless you edit it.`}
            </p>
          </div>
        </div>
        {qtyUp && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Total cost for added shares only ({ccy})
            </label>
            <input
              type="number"
              step="any"
              className="input-base"
              value={addCostStr}
              onChange={(e) => setAddCostStr(e.target.value)}
              placeholder="Required unless you restate full book cost above"
            />
            <p className="text-xs text-slate-500 mt-1">
              Prefer this when you bought more shares — the exact added cost is blended into WAC. Or edit the full
              restated book cost above instead.
            </p>
          </div>
        )}
        <label className="flex items-start gap-2 text-sm text-slate-700 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={alignLotCosts}
            onChange={(e) => setAlignLotCosts(e.target.checked)}
          />
          <span>
            Align open lots to this book — trim excess open quantity FIFO (non-cash; not a withdrawal), then scale
            lot costs so open-lot book cost matches average cost × quantity.
          </span>
        </label>
        {preview?.impacts?.length ? (
          <ul className="text-xs text-slate-600 list-disc pl-4 space-y-1">
            {preview.impacts.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Reason (required)</label>
          <input
            type="text"
            className="input-base"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Match broker statement qty and avg cost"
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
            {busy ? 'Applying…' : preview?.noop ? 'Already matches' : 'Apply holding reconcile'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default ReconcileQuantityModal;
