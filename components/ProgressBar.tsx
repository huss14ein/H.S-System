
import React, { useState, useEffect } from 'react';

interface ProgressBarProps {
  value: number;
  max: number;
  color?: string;
  /** When set, used as the fill instead of `color` (e.g. gradient classes). */
  fillClassName?: string;
  /** Track (background) bar — default neutral gray */
  trackClassName?: string;
  heightClass?: string;
}

const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  max,
  color = 'bg-primary',
  fillClassName,
  trackClassName = 'bg-slate-200/90',
  heightClass = 'h-2.5',
}) => {
  const [width, setWidth] = useState(0);
  const fill = fillClassName ?? color;
  
  useEffect(() => {
    const percentage = max > 0 ? Math.min((value / max) * 100, 100) : 0;
    // Set timeout to allow the initial 0 width to render before transitioning
    const timer = setTimeout(() => setWidth(percentage), 100); 
    return () => clearTimeout(timer);
  }, [value, max]);

  return (
    <div className={`w-full overflow-hidden rounded-full ${trackClassName} ${heightClass} shadow-inner`}>
      <div
        className={`${fill} ${heightClass} rounded-full transition-all duration-1000 ease-out shadow-sm ring-1 ring-white/30`}
        style={{ width: `${width}%` }}
      ></div>
    </div>
  );
};

export default ProgressBar;