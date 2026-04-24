import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info' | 'default';

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

function defaultDurationForVariant(v: ToastVariant): number {
  switch (v) {
    case 'error':
      return 9000;
    case 'warning':
      return 7000;
    case 'info':
      return 5500;
    case 'success':
      return 4500;
    default:
      return 4000;
  }
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

/** Imperative toast - call from anywhere (e.g. DataContext, services). Omits duration to use variant-based defaults. */
export function toast(message: string, variant: ToastVariant = 'default', duration?: number): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<ToastEventDetail>(TOAST_EVENT, {
      detail: { message, variant, duration },
    }),
  );
}

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, variant: ToastVariant = 'default', duration?: number, action?: ToastAction) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const resolvedDuration = duration ?? defaultDurationForVariant(variant);
      const item: ToastItem = { id, message, variant, duration: resolvedDuration, action };
      setToasts((prev) => [...prev.slice(-4), item]);
    },
    [],
  );

  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<ToastEventDetail>).detail;
      if (d?.message) showToast(d.message, d.variant ?? 'default', d.duration, d.action);
    };
    window.addEventListener(TOAST_EVENT, handler);
    return () => window.removeEventListener(TOAST_EVENT, handler);
  }, [showToast]);

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
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 max-w-md w-full pointer-events-none">
      <div className="flex flex-col gap-2 pointer-events-auto">
        {toasts.map((t) => (
          <ToastItem key={t.id} item={t} onDismiss={() => onDismiss(t.id)} />
        ))}
      </div>
    </div>
  );
}

const variantSurface: Record<ToastVariant, string> = {
  success:
    'bg-emerald-50 text-emerald-950 border border-emerald-200/90 border-l-[5px] border-l-emerald-600 shadow-lg shadow-emerald-900/10',
  error: 'bg-rose-50 text-rose-950 border border-rose-200/90 border-l-[5px] border-l-rose-600 shadow-lg shadow-rose-900/10',
  warning:
    'bg-amber-50 text-amber-950 border border-amber-200/90 border-l-[5px] border-l-amber-500 shadow-lg shadow-amber-900/10',
  info: 'bg-sky-50 text-sky-950 border border-sky-200/90 border-l-[5px] border-l-sky-600 shadow-lg shadow-sky-900/10',
  default: 'bg-slate-50 text-slate-900 border border-slate-200/90 border-l-[5px] border-l-slate-600 shadow-lg shadow-slate-900/10',
};

const dismissBtnClass: Record<ToastVariant, string> = {
  success: 'text-emerald-700/80 hover:text-emerald-900 focus:ring-emerald-500/40',
  error: 'text-rose-700/80 hover:text-rose-900 focus:ring-rose-500/40',
  warning: 'text-amber-800/80 hover:text-amber-950 focus:ring-amber-500/40',
  info: 'text-sky-800/80 hover:text-sky-950 focus:ring-sky-500/40',
  default: 'text-slate-600 hover:text-slate-900 focus:ring-slate-500/40',
};

function ToastGlyph({ variant }: { variant: ToastVariant }) {
  const common = 'h-5 w-5 shrink-0 mt-0.5';
  switch (variant) {
    case 'success':
      return (
        <svg className={`${common} text-emerald-600`} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      );
    case 'error':
      return (
        <svg className={`${common} text-rose-600`} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      );
    case 'warning':
      return (
        <svg className={`${common} text-amber-600`} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      );
    case 'info':
      return (
        <svg className={`${common} text-sky-600`} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M12 20a8 8 0 100-16 8 8 0 000 16z" />
        </svg>
      );
    default:
      return (
        <svg className={`${common} text-slate-600`} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M12 20a8 8 0 100-16 8 8 0 000 16z" />
        </svg>
      );
  }
}

function ToastItem({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const surface = variantSurface[item.variant];
  const btnRing = dismissBtnClass[item.variant];
  const endAtRef = useRef(Date.now() + item.duration);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  };

  useEffect(() => {
    endAtRef.current = Date.now() + item.duration;
    clearTimer();
    timerRef.current = setTimeout(() => onDismiss(), item.duration);
    return () => clearTimer();
  }, [item.id, item.duration, onDismiss]);

  const onPause = () => {
    clearTimer();
  };

  const onResume = () => {
    const ms = Math.max(0, endAtRef.current - Date.now());
    if (ms === 0) onDismiss();
    else timerRef.current = setTimeout(() => onDismiss(), ms);
  };

  const live = item.variant === 'error' ? 'assertive' : 'polite';
  const role = item.variant === 'error' ? 'alert' : 'status';

  return (
    <div
      className={`px-3.5 py-3 rounded-xl text-sm font-medium animate-slideInRight ${surface}`}
      role={role}
      aria-live={live}
      onMouseEnter={onPause}
      onMouseLeave={onResume}
      onFocus={onPause}
      onBlur={onResume}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex items-start gap-2.5 flex-1 min-w-0">
          <ToastGlyph variant={item.variant} />
          <span className="flex-1 min-w-0 whitespace-pre-line leading-snug">{item.message}</span>
        </span>
        <button
          type="button"
          onClick={onDismiss}
          className={`shrink-0 p-0.5 -m-1 rounded transition-opacity opacity-80 hover:opacity-100 focus:outline-none focus:ring-2 ${btnRing}`}
          aria-label="Dismiss notification"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      {item.action && (
        <button
          type="button"
          className={`mt-2.5 text-xs font-bold uppercase tracking-wide underline underline-offset-2 opacity-95 hover:opacity-100 text-left ${
            item.variant === 'error'
              ? 'text-rose-800'
              : item.variant === 'warning'
                ? 'text-amber-900'
                : item.variant === 'success'
                  ? 'text-emerald-900'
                  : item.variant === 'info'
                    ? 'text-sky-900'
                    : 'text-slate-800'
          }`}
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
