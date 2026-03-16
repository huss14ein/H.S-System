import React from 'react';

interface LoadingSpinnerProps {
  /** Optional message below the spinner */
  message?: string;
  /** Size: 'sm' | 'md' | 'lg' */
  size?: 'sm' | 'md' | 'lg';
  /** Optional wrapper class (e.g. for min height) */
  className?: string;
  /** Accessible label for screen readers (recommended when used for page/section loading) */
  ariaLabel?: string;
}

const sizeClasses = {
  sm: 'h-8 w-8 border-2',
  md: 'h-12 w-12 border-2',
  lg: 'h-16 w-16 border-2',
};

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ message, size = 'lg', className = '', ariaLabel }) => (
  <div className={`flex flex-col justify-center items-center gap-3 ${className}`} aria-busy={!!ariaLabel}>
    <div
      className={`animate-spin rounded-full border-primary ${sizeClasses[size]}`}
      aria-label={ariaLabel}
      aria-hidden={!ariaLabel}
      role={ariaLabel ? 'status' : undefined}
    />
    {message && <p className="text-sm text-gray-500">{message}</p>}
  </div>
);

export default LoadingSpinner;
