import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

export type ToastVariant = 'success' | 'error' | 'info' | 'default';

export type ToastAction = { label: string; onAction: () => void };

export interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
  duration: number;
  action?: ToastAction;
}

const TOAST_EVENT = 'finova-toast';

interface ToastEventDetail {
  message: string;
  variant?: ToastVariant;
  duration?: number;
  action?: ToastAction;
}

const ToastContext = createContext<{
  toasts: ToastItem[];
  showToast: (message: string, variant?: ToastVariant, duration?: number, action?: ToastAction) => void;
} | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) return { toasts: [], showToast: () => {} };
  return ctx;
}

/** Imperative toast - call from anywhere (e.g. DataContext, services) */
export function toast(message: string, variant: ToastVariant = 'default', duration = 4000): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ToastEventDetail>(TOAST_EVENT, { detail: { message, variant, duration } }));
}

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    const t = timersRef.current.get(id);
    if (t) clearTimeout(t);
    timersRef.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, variant: ToastVariant = 'default', duration = 4000, action?: ToastAction) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const item: ToastItem = { id, message, variant, duration, action };
    setToasts((prev) => [...prev.slice(-4), item]);
    const t = setTimeout(() => removeToast(id), duration);
    timersRef.current.set(id, t);
  }, [removeToast]);

  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<ToastEventDetail>).detail;
      if (d?.message) showToast(d.message, d.variant ?? 'default', d.duration ?? 4000, d.action);
    };
    window.addEventListener(TOAST_EVENT, handler);
    return () => window.removeEventListener(TOAST_EVENT, handler);
  }, [showToast]);

  useEffect(() => () => timersRef.current.forEach((t) => clearTimeout(t)), []);

  return (
    <ToastContext.Provider value={{ toasts, showToast }}>
      {children}
      <ToastStack toasts={toasts} onDismiss={removeToast} />
    </ToastContext.Provider>
  );
};

function ToastStack({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div
      className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm w-full pointer-events-none"
      aria-live="polite"
      role="status"
    >
      <div className="flex flex-col gap-2 pointer-events-auto">
        {toasts.map((t) => (
          <ToastItem key={t.id} item={t} onDismiss={() => onDismiss(t.id)} />
        ))}
      </div>
    </div>
  );
}

const variantStyles: Record<ToastVariant, string> = {
  success: 'bg-emerald-600 text-white border-emerald-700 shadow-emerald-900/20',
  error: 'bg-red-600 text-white border-red-700 shadow-red-900/20',
  info: 'bg-blue-600 text-white border-blue-700 shadow-blue-900/20',
  default: 'bg-slate-800 text-white border-slate-700 shadow-slate-900/30',
};

function ToastItem({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const style = variantStyles[item.variant];
  return (
    <div
      className={`px-4 py-3 rounded-xl shadow-lg border text-sm font-medium animate-slideInRight ${style}`}
      role="alert"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex-1 min-w-0">{item.message}</span>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 p-0.5 -m-1 rounded opacity-80 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-white/50"
          aria-label="Dismiss"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      {item.action && (
        <button
          type="button"
          className="mt-2 text-xs font-bold uppercase tracking-wide underline opacity-95 hover:opacity-100"
          onClick={() => {
            try {
              item.action!.onAction();
            } finally {
              onDismiss();
            }
          }}
        >
          {item.action.label}
        </button>
      )}
    </div>
  );
}
