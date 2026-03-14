import React, { useState, useRef, useEffect } from 'react';

interface InfoHintProps {
  text: string;
  /** When 'bottom', popover opens below (e.g. in table headers). Default opens below on small viewports. */
  placement?: 'auto' | 'top' | 'bottom';
}

const InfoHint: React.FC<InfoHintProps> = ({ text, placement = 'auto' }) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const showBelow = placement !== 'top';

  return (
    <span ref={containerRef} className="relative inline-flex items-center align-middle shrink-0 ml-0.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-300 text-[11px] font-bold text-slate-600 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-primary/30"
        aria-label="More information"
        title={text.slice(0, 80) + (text.length > 80 ? '…' : '')}
      >
        !
      </button>
      {open && (
        <div
          className={`absolute z-[100] left-0 w-72 max-w-[min(20rem,90vw)] max-h-56 overflow-y-auto rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-xl leading-relaxed whitespace-normal break-words ${
            showBelow ? 'top-full mt-1.5' : 'bottom-full mb-1.5'
          }`}
          role="tooltip"
        >
          {text}
        </div>
      )}
    </span>
  );
};

export default InfoHint;
