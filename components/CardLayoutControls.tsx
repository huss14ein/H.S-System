import React, { useState, useRef, useEffect } from 'react';

type CardLayoutControlsProps = {
  index: number;
  total: number;
  isExpanded: boolean;
  onMove: (direction: 'up' | 'down') => void;
  onToggleSize: () => void;
  /** Optional: show drag handle for reorder (parent handles drag events) */
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
};

const CardLayoutControls: React.FC<CardLayoutControlsProps> = ({
  index,
  total,
  isExpanded,
  onMove,
  onToggleSize,
  dragHandleProps,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  return (
    <div className="flex items-center gap-1">
      {dragHandleProps && (
        <div
          {...dragHandleProps}
          className="cursor-grab active:cursor-grabbing p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 touch-none"
          title="Drag to reorder"
          aria-label="Drag to reorder card"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M7 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm0 6a1 1 0 011 1v1a1 1 0 11-2 0V9a1 1 0 011-1zm0 6a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zm6-12a1 1 0 01-1 1h-1a1 1 0 110 2h1a1 1 0 011 1zm0 6a1 1 0 01-1 1h-1a1 1 0 110 2h1a1 1 0 011 1zm0 6a1 1 0 01-1 1h-1a1 1 0 110 2h1a1 1 0 011 1z" />
          </svg>
        </div>
      )}
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          className="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100"
          title="Layout options"
          aria-label="Card layout options"
          aria-expanded={menuOpen}
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
          </svg>
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 py-1 w-40 bg-white border border-gray-200 rounded-lg shadow-lg z-30 text-left">
            <button
              type="button"
              onClick={() => { onMove('up'); setMenuOpen(false); }}
              disabled={index === 0}
              className="w-full px-3 py-2 text-sm text-left hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <span aria-hidden>↑</span> Move up
            </button>
            <button
              type="button"
              onClick={() => { onMove('down'); setMenuOpen(false); }}
              disabled={index === total - 1}
              className="w-full px-3 py-2 text-sm text-left hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <span aria-hidden>↓</span> Move down
            </button>
            <hr className="my-1 border-gray-100" />
            <button
              type="button"
              onClick={() => { onToggleSize(); setMenuOpen(false); }}
              className="w-full px-3 py-2 text-sm text-left hover:bg-gray-50 flex items-center gap-2"
            >
              {isExpanded ? 'Compact' : 'Expand'} card
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default CardLayoutControls;
