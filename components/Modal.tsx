import React, { ReactNode, useRef, useEffect, useCallback, useId } from 'react';
import { XMarkIcon } from './icons/XMarkIcon';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children }) => {
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
    const list = Array.from(focusables);
    if (list.length === 0) return;
    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (!active || !panel.contains(active)) return;
    const activeIndex = list.indexOf(active);
    const isInList = activeIndex >= 0;
    e.preventDefault();
    if (e.shiftKey) {
      if (!isInList) last?.focus();
      else if (active === first) last?.focus();
      else list[activeIndex - 1]?.focus();
    } else {
      if (!isInList) first?.focus();
      else if (active === last) first?.focus();
      else list[activeIndex + 1]?.focus();
    }
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusables = panel?.querySelectorAll<HTMLElement>(FOCUSABLE);
    const first = focusables?.length ? focusables[0] : null;
    first?.focus();
    return () => { previouslyFocused?.focus(); };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 bg-black/50 z-50 overflow-y-auto p-4 flex justify-center items-start pt-16 sm:pt-24"
      aria-modal="true"
      role="dialog"
      aria-labelledby={titleId}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className="bg-white rounded-xl shadow-xl max-w-lg w-full mb-8 border border-slate-200"
        role="document"
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex justify-between items-center px-5 py-4 border-b border-slate-200 flex-shrink-0">
          <h3 id={titleId} className="text-lg font-semibold text-dark">{title}</h3>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2" aria-label="Close">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5 sm:p-6">
          {children}
        </div>
      </div>
    </div>
  );
};

export default Modal;