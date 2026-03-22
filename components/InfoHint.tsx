import React, { useState, useRef, useEffect } from 'react';
import { useSelfLearning } from '../context/SelfLearningContext';

interface InfoHintProps {
  text: string;
  /** When 'bottom', popover opens below (e.g. in table headers). Default opens below on small viewports. */
  placement?: 'auto' | 'top' | 'bottom';
  /** Horizontal alignment of the popover under the (!) control. Use `right` when the control sits on the right (e.g. collapsible headers). */
  popoverAlign?: 'left' | 'right';
  /** Optional: for self-learning. When user closes the hint, we record dismissal to show it less often. */
  hintId?: string;
  hintPage?: string;
}

const InfoHint: React.FC<InfoHintProps> = ({ text, placement = 'auto', popoverAlign = 'left', hintId, hintPage }) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);
  const { trackHintDismissed } = useSelfLearning();

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        if (hintId && hintPage) trackHintDismissed(hintId, hintPage);
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, hintId, hintPage, trackHintDismissed]);

  const showBelow = placement !== 'top';
  const panelH = popoverAlign === 'right' ? 'right-0 left-auto' : 'left-0';

  const stopParent = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen((v) => {
      if (v && hintId && hintPage) trackHintDismissed(hintId, hintPage);
      return !v;
    });
  };

  return (
    <span ref={containerRef} className="relative inline-flex items-center align-middle shrink-0 ml-0.5">
      <button
        type="button"
        onClick={toggle}
        onMouseDown={stopParent}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gray-300 text-[11px] font-bold text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary/30"
        aria-label="More information"
        aria-expanded={open}
        title={text.slice(0, 80) + (text.length > 80 ? '…' : '')}
      >
        !
      </button>
      {open && (
        <div
          className={`absolute z-[100] ${panelH} w-72 max-w-[min(20rem,90vw)] max-h-56 overflow-y-auto rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-xl leading-relaxed whitespace-normal break-words text-left ${
            showBelow ? 'top-full mt-1.5' : 'bottom-full mb-1.5'
          }`}
          role="tooltip"
          onClick={stopParent}
          onMouseDown={stopParent}
        >
          {text}
        </div>
      )}
    </span>
  );
};

export default InfoHint;
