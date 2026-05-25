import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import Modal from '../components/Modal';
import { registerRecordConfirm, formatNativeConfirmMessage } from '../services/recordConfirmBridge';

export type ConfirmActionOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'primary' | 'danger';
  /** Extra detail lines (amount, account, symbol, etc.) */
  details?: string[];
};

type ConfirmFn = (options: ConfirmActionOptions) => Promise<boolean>;

const ConfirmActionContext = createContext<ConfirmFn | null>(null);

export const ConfirmActionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ConfirmActionOptions | null>(null);
  const resolveRef = useRef<((v: boolean) => void) | null>(null);

  const confirmAction = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setOpts(options);
      setOpen(true);
    });
  }, []);

  useEffect(() => {
    registerRecordConfirm(confirmAction);
    return () => registerRecordConfirm(null);
  }, [confirmAction]);

  const finish = (result: boolean) => {
    setOpen(false);
    setOpts(null);
    const r = resolveRef.current;
    resolveRef.current = null;
    r?.(result);
  };

  return (
    <ConfirmActionContext.Provider value={confirmAction}>
      {children}
      <Modal
        isOpen={open}
        onClose={() => finish(false)}
        title={opts?.title ?? 'Confirm'}
        maxWidthClass="max-w-md"
      >
        {opts && (
          <div className="space-y-4">
            <p className="text-sm text-slate-700 whitespace-pre-wrap">{opts.message}</p>
            {opts.details && opts.details.length > 0 && (
              <ul className="text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 space-y-1">
                {opts.details.map((line) => (
                  <li key={line} className="text-slate-800">
                    {line}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-slate-500">This will update your ledger. Review amounts before confirming.</p>
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => finish(false)}>
                {opts.cancelLabel ?? 'Cancel'}
              </button>
              <button
                type="button"
                className={opts.variant === 'danger' ? 'btn-danger' : 'btn-primary'}
                onClick={() => finish(true)}
              >
                {opts.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </ConfirmActionContext.Provider>
  );
};

export function useConfirmAction(): ConfirmFn {
  const ctx = useContext(ConfirmActionContext);
  if (!ctx) {
    return async (options) => {
      if (typeof window !== 'undefined') {
        return window.confirm(formatNativeConfirmMessage(options));
      }
      return false;
    };
  }
  return ctx;
}
