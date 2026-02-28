import React from 'react';

type CardLayoutControlsProps = {
  index: number;
  total: number;
  isExpanded: boolean;
  onMove: (direction: 'up' | 'down') => void;
  onToggleSize: () => void;
};

const CardLayoutControls: React.FC<CardLayoutControlsProps> = ({
  index,
  total,
  isExpanded,
  onMove,
  onToggleSize,
}) => (
  <div className="flex items-center gap-1">
    <button type="button" onClick={() => onMove('up')} disabled={index === 0} className="px-2 py-1 text-xs border rounded disabled:opacity-40" title="Move card up" aria-label="Move card up">↑</button>
    <button type="button" onClick={() => onMove('down')} disabled={index === total - 1} className="px-2 py-1 text-xs border rounded disabled:opacity-40" title="Move card down" aria-label="Move card down">↓</button>
    <button type="button" onClick={onToggleSize} className="px-2 py-1 text-xs border rounded" title="Toggle card size" aria-label={isExpanded ? 'Compact card' : 'Expand card'}>{isExpanded ? 'Compact' : 'Expand'}</button>
  </div>
);

export default CardLayoutControls;
