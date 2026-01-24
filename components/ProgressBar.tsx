
import React, { useState, useEffect } from 'react';

interface ProgressBarProps {
  value: number;
  max: number;
  color?: string;
}

const ProgressBar: React.FC<ProgressBarProps> = ({ value, max, color = 'bg-primary' }) => {
  const [width, setWidth] = useState(0);
  
  useEffect(() => {
    const percentage = max > 0 ? Math.min((value / max) * 100, 100) : 0;
    // Set timeout to allow the initial 0 width to render before transitioning
    const timer = setTimeout(() => setWidth(percentage), 100); 
    return () => clearTimeout(timer);
  }, [value, max]);

  return (
    <div className="w-full bg-gray-200 rounded-full h-2.5">
      <div
        className={`${color} h-2.5 rounded-full transition-all duration-1000 ease-out`}
        style={{ width: `${width}%` }}
      ></div>
    </div>
  );
};

export default ProgressBar;