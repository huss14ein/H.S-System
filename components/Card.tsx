import React, { useState, useEffect, useRef } from 'react';
import { InformationCircleIcon } from './icons/InformationCircleIcon';
import { ArrowTrendingUpIcon } from './icons/ArrowTrendingUpIcon';
import { ArrowTrendingDownIcon } from './icons/ArrowTrendingDownIcon';

interface CardProps {
  title: string;
  value: React.ReactNode;
  trend?: string;
  tooltip?: string;
  onClick?: () => void;
  valueColor?: string;
  indicatorColor?: 'green' | 'yellow' | 'red';
  icon?: React.ReactNode;
}

const Card: React.FC<CardProps> = ({ title, value, trend, tooltip, onClick, valueColor, indicatorColor, icon }) => {
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const prevValueRef = useRef<number | undefined>(undefined);

  const isPositive = trend?.includes('+') || (trend && /(surplus|under|healthy)/i.test(trend));
  const isNegative = trend?.includes('-') || (trend && /(deficit|over|critical|low)/i.test(trend));
  let trendColor = 'text-gray-500';
  if (isPositive) trendColor = 'text-success';
  if (isNegative) trendColor = 'text-danger';

  useEffect(() => {
    const isNumeric = typeof value === 'number' || (typeof value === 'string' && !isNaN(parseFloat(String(value).replace(/[^0-9.,$SAR]+/g, ""))));
    if (!isNumeric) return;
    
    const numericValue = parseFloat(String(value).replace(/[^0-9.-]+/g, ""));

    if (prevValueRef.current !== undefined && Math.abs(numericValue - prevValueRef.current) > 0.001) {
      setFlash(numericValue > prevValueRef.current ? 'up' : 'down');
      const timer = setTimeout(() => setFlash(null), 1000);
      return () => clearTimeout(timer);
    }
    
    prevValueRef.current = numericValue;
  }, [value]);
  
  const indicatorClass = 
      indicatorColor === 'green' ? 'border-green-500' :
      indicatorColor === 'yellow' ? 'border-yellow-500' :
      indicatorColor === 'red' ? 'border-red-500' :
      'border-transparent';

  const flashClass = flash === 'up' ? 'flash-green' : flash === 'down' ? 'flash-red' : '';

  return (
    <div 
      className={`bg-gradient-to-br from-white to-slate-50 p-6 rounded-lg shadow-md hover:shadow-xl hover:scale-[1.02] transition-all duration-300 ease-in-out flex flex-col border-t-4 ${indicatorClass} ${onClick ? 'cursor-pointer' : ''} ${flashClass}`}
      onClick={onClick}
      style={{
        backgroundImage: 'radial-gradient(circle at top right, rgba(239, 246, 255, 0.5) 0%, transparent 50%)',
      }}
    >
      <div className="flex items-start justify-between">
        <h3 className="text-sm font-medium text-gray-500">{title}</h3>
        {icon || (tooltip && (
          <div className="relative group">
            <InformationCircleIcon className="h-5 w-5 text-gray-400" />
            <div className="absolute bottom-full mb-2 w-48 bg-gray-800 text-white text-xs rounded py-1 px-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none left-1/2 -translate-x-1/2 z-10">
              {tooltip}
              <svg className="absolute text-gray-800 h-2 w-full left-0 top-full" x="0px" y="0px" viewBox="0 0 255 255"><polygon className="fill-current" points="0,0 127.5,127.5 255,0"/></svg>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex-grow">
        <p className={`text-3xl font-extrabold break-words ${valueColor || 'text-dark'}`}>{value}</p>
        {trend && (
          <div className={`flex items-center text-sm mt-1 font-medium ${trendColor}`}>
            {isPositive && <ArrowTrendingUpIcon className="h-4 w-4 mr-1"/>}
            {isNegative && <ArrowTrendingDownIcon className="h-4 w-4 mr-1"/>}
            <span>{trend}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default Card;