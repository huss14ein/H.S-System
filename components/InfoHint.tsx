import React, { useState, useRef, useEffect } from 'react';

interface InfoHintProps {
  text: string;
}

const InfoHint: React.FC<InfoHintProps> = ({ text }) => {
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

  return (
    <span ref={containerRef} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 text-[11px] font-bold text-gray-600 hover:bg-gray-100"
        aria-label="More information"
        title="More information"
      >
        !
      </button>
      {open && (
        <div className="absolute z-20 top-7 right-0 w-72 max-w-[min(20rem,90vw)] rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-lg leading-relaxed">
          {text}
        </div>
      )}
    </span>
  );
};

export default InfoHint;
