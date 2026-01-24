
import React, { useState, useEffect, useRef } from 'react';
import { InformationCircleIcon } from './icons/InformationCircleIcon';
import { ArrowTrendingUpIcon } from './icons/ArrowTrendingUpIcon';
import { ArrowTrendingDownIcon } from './icons/ArrowTrendingDownIcon';
import { useCurrency } from '../context/CurrencyContext';

interface CardProps {
  title: string;
  value: React.ReactNode;
  trend?: string;
  tooltip?: string;
  onClick?: () => void;
  valueColor?: string;
  indicatorColor?: 'green' | 'yellow' | 'red';
}

const Card: React.FC<CardProps> = ({ title, value, trend, tooltip, onClick, valueColor, indicatorColor }) => {
  const { currency } = useCurrency();
  const isPositive = trend?.includes('+') || trend?.toLowerCase().includes('surplus') || trend?.toLowerCase().includes('under');
  const isNegative = trend?.includes('-') || trend?.toLowerCase().includes('deficit') || trend?.toLowerCase().includes('over');
  let trendColor = 'text-gray-500';
  if (isPositive) trendColor = 'text-success';
  if (isNegative) trendColor = 'text-danger';

  const [displayValue, setDisplayValue] = useState<React.ReactNode>(value);
  const prevValueRef = useRef<number | null>(null);

  useEffect(() => {
    const isNumeric = typeof value === 'number' || !isNaN(parseFloat(String(value).replace(/[^0-9.-]+/g,"")));
    if (!isNumeric) {
      setDisplayValue(value);
      return;
    }

    const finalValue = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^0-9.-]+/g,""));
    const startValue = prevValueRef.current ?? 0;
    
    if (finalValue !== startValue) {
        prevValueRef.current = finalValue;
    }

    const duration = 1000;
    const startTime = Date.now();

    const updateValue = () => {
        const elapsedTime = Date.now() - startTime;
        if (elapsedTime >= duration) {
            setDisplayValue(value);
            return;
        }

        const progress = elapsedTime / duration;
        const currentValue = startValue + (finalValue - startValue) * progress;
        
        const originalStr = String(value);
        const isCurrency = originalStr.includes('SAR') || originalStr.includes('$');
        const isPercent = originalStr.endsWith('%');

        if (isCurrency) {
            setDisplayValue(new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: currency,
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            }).format(currentValue));
        } else if (isPercent) {
             setDisplayValue(`${currentValue.toFixed(1)}%`);
        } else {
             setDisplayValue(currentValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
        }

        requestAnimationFrame(updateValue);
    };

    if (Math.abs(finalValue - startValue) > 0.01) {
      requestAnimationFrame(updateValue);
    } else {
      setDisplayValue(value);
    }

  }, [value, currency]);
  
  const indicatorClass = 
      indicatorColor === 'green' ? 'border-green-500' :
      indicatorColor === 'yellow' ? 'border-yellow-500' :
      indicatorColor === 'red' ? 'border-red-500' :
      'border-transparent';


  return (
    <div 
      className={`bg-white p-6 rounded-lg shadow-md hover:shadow-xl hover:scale-[1.02] transition-all duration-300 ease-in-out flex flex-col border-t-4 ${indicatorClass} ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <h3 className="text-sm font-medium text-gray-500">{title}</h3>
        {tooltip && (
          <div className="relative group">
            <InformationCircleIcon className="h-5 w-5 text-gray-400" />
            <div className="absolute bottom-full mb-2 w-48 bg-gray-800 text-white text-xs rounded py-1 px-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none left-1/2 -translate-x-1/2 z-10">
              {tooltip}
              <svg className="absolute text-gray-800 h-2 w-full left-0 top-full" x="0px" y="0px" viewBox="0 0 255 255"><polygon className="fill-current" points="0,0 127.5,127.5 255,0"/></svg>
            </div>
          </div>
        )}
      </div>
      <div className="mt-2 flex-grow">
        <p className={`text-3xl font-semibold break-words ${valueColor || 'text-dark'}`}>{displayValue}</p>
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
