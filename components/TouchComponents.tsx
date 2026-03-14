import React, { useState } from 'react';

interface TouchButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  hapticFeedback?: boolean;
}

const TouchButton: React.FC<TouchButtonProps> = ({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  className = '',
  hapticFeedback = true
}) => {
  const [isPressed, setIsPressed] = useState(false);

  const handleTouchStart = () => {
    if (!disabled && !loading) {
      setIsPressed(true);
      if (hapticFeedback && 'vibrate' in navigator) {
        navigator.vibrate(10);
      }
    }
  };

  const handleTouchEnd = () => {
    setIsPressed(false);
  };

  const handleClick = () => {
    if (!disabled && !loading) {
      onClick?.();
    }
  };

  const getVariantClasses = () => {
    switch (variant) {
      case 'primary':
        return 'bg-blue-600 text-white active:bg-blue-700';
      case 'secondary':
        return 'bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-white active:bg-gray-300 dark:active:bg-gray-600';
      case 'danger':
        return 'bg-red-600 text-white active:bg-red-700';
      case 'ghost':
        return 'bg-transparent text-gray-700 dark:text-gray-300 active:bg-gray-100 dark:active:bg-gray-800';
      default:
        return 'bg-blue-600 text-white active:bg-blue-700';
    }
  };

  const getSizeClasses = () => {
    switch (size) {
      case 'sm':
        return 'px-4 py-3 text-sm min-h-[44px] min-w-[44px]';
      case 'md':
        return 'px-6 py-4 text-base min-h-[48px] min-w-[48px]';
      case 'lg':
        return 'px-8 py-6 text-lg min-h-[52px] min-w-[52px]';
      default:
        return 'px-6 py-4 text-base min-h-[48px] min-w-[48px]';
    }
  };

  return React.createElement(
    'button',
    {
      className: `
        rounded-xl font-medium transition-all duration-150 select-none
        ${getVariantClasses()}
        ${getSizeClasses()}
        ${isPressed ? 'scale-95' : 'scale-100'}
        ${disabled || loading ? 'opacity-50 cursor-not-allowed' : 'active:scale-95'}
        ${className}
      `,
      onClick: handleClick,
      onTouchStart: handleTouchStart,
      onTouchEnd: handleTouchEnd,
      disabled: disabled || loading,
      type: 'button'
    },
    [
      loading && React.createElement(
        'div',
        { key: 'spinner', className: 'w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin' }
      ),
      !loading && children
    ]
  );
};

// Touch-friendly Card Component
interface TouchCardProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  hapticFeedback?: boolean;
  active?: boolean;
}

const TouchCard: React.FC<TouchCardProps> = ({
  children,
  onClick,
  className = '',
  hapticFeedback = true,
  active = false
}) => {
  const [isPressed, setIsPressed] = useState(false);

  const handleTouchStart = () => {
    setIsPressed(true);
    if (hapticFeedback && 'vibrate' in navigator) {
      navigator.vibrate(5);
    }
  };

  const handleTouchEnd = () => {
    setIsPressed(false);
  };

  return React.createElement(
    'div',
    {
      className: `
        bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm border border-gray-200 dark:border-gray-700
        ${onClick ? 'cursor-pointer active:scale-98' : ''}
        ${isPressed ? 'scale-98 shadow-md' : 'shadow-sm'}
        ${active ? 'ring-2 ring-blue-500 ring-offset-2' : ''}
        transition-all duration-150 select-none
        ${className}
      `,
      onClick,
      onTouchStart: onClick ? handleTouchStart : undefined,
      onTouchEnd: onClick ? handleTouchEnd : undefined
    },
    children
  );
};

// Touch-friendly Input Component
interface TouchInputProps {
  type?: 'text' | 'email' | 'password' | 'number' | 'tel';
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  label?: string;
  error?: string;
  disabled?: boolean;
  className?: string;
  icon?: React.ReactNode;
}

const TouchInput: React.FC<TouchInputProps> = ({
  type = 'text',
  placeholder,
  value,
  onChange,
  label,
  error,
  disabled = false,
  className = '',
  icon
}) => {
  const [isFocused, setIsFocused] = useState(false);

  return React.createElement(
    'div',
    { className: `space-y-2 ${className}` },
    [
      label && React.createElement(
        'label',
        { key: 'label', className: 'block text-sm font-medium text-gray-700 dark:text-gray-300' },
        label
      ),
      React.createElement(
        'div',
        { key: 'input-wrapper', className: 'relative' },
        [
          icon && React.createElement(
            'div',
            { key: 'icon', className: 'absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400' },
            icon
          ),
          React.createElement(
            'input',
            {
              key: 'input',
              type,
              placeholder,
              value,
              onChange: (e) => onChange?.(e.target.value),
              onFocus: () => setIsFocused(true),
              onBlur: () => setIsFocused(false),
              disabled,
              className: `
                w-full px-4 py-4 text-base rounded-xl border-2 transition-all duration-150
                ${icon ? 'pl-12' : 'pl-4'}
                ${isFocused ? 'border-blue-500 ring-2 ring-blue-200 dark:ring-blue-800' : 'border-gray-300 dark:border-gray-600'}
                ${error ? 'border-red-500 ring-2 ring-red-200 dark:ring-red-800' : ''}
                ${disabled ? 'bg-gray-100 dark:bg-gray-700 text-gray-500' : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white'}
                focus:outline-none min-h-[48px]
              `
            }
          )
        ]
      ),
      error && React.createElement(
        'p',
        { key: 'error', className: 'text-sm text-red-600 dark:text-red-400' },
        error
      )
    ]
  );
};

// Touch-friendly Switch Component
interface TouchSwitchProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
  hapticFeedback?: boolean;
}

const TouchSwitch: React.FC<TouchSwitchProps> = ({
  checked = false,
  onChange,
  label,
  disabled = false,
  className = '',
  hapticFeedback = true
}) => {
  const [isChecked, setIsChecked] = useState(checked);

  const handleToggle = () => {
    if (!disabled) {
      const newChecked = !isChecked;
      setIsChecked(newChecked);
      onChange?.(newChecked);
      
      if (hapticFeedback && 'vibrate' in navigator) {
        navigator.vibrate(10);
      }
    }
  };

  return React.createElement(
    'div',
    { className: `flex items-center space-x-3 ${className}` },
    [
      label && React.createElement(
        'span',
        { key: 'label', className: 'text-sm font-medium text-gray-700 dark:text-gray-300' },
        label
      ),
      React.createElement(
        'button',
        {
          key: 'switch',
          onClick: handleToggle,
          disabled,
          className: `
            relative inline-flex h-12 w-20 items-center rounded-full transition-colors duration-150
            ${isChecked ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}
            ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer active:scale-95'}
          `
        },
        React.createElement(
          'span',
          {
            className: `
              inline-block h-8 w-8 transform rounded-full bg-white shadow-lg transition-transform duration-150
              ${isChecked ? 'translate-x-11' : 'translate-x-1'}
            `
          }
        )
      )
    ]
  );
};

// Touch-friendly Slider Component
interface TouchSliderProps {
  min?: number;
  max?: number;
  value?: number;
  onChange?: (value: number) => void;
  label?: string;
  step?: number;
  disabled?: boolean;
  className?: string;
  hapticFeedback?: boolean;
}

const TouchSlider: React.FC<TouchSliderProps> = ({
  min = 0,
  max = 100,
  value = 50,
  onChange,
  label,
  step = 1,
  disabled = false,
  className = '',
  hapticFeedback = true
}) => {
  const [currentValue, setCurrentValue] = useState(value);
  const [isDragging, setIsDragging] = useState(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseInt(e.target.value);
    setCurrentValue(newValue);
    onChange?.(newValue);
    
    if (hapticFeedback && 'vibrate' in navigator) {
      navigator.vibrate(5);
    }
  };

  const percentage = ((currentValue - min) / (max - min)) * 100;

  return React.createElement(
    'div',
    { className: `space-y-3 ${className}` },
    [
      label && React.createElement(
        'div',
        { key: 'header', className: 'flex justify-between items-center' },
        [
          React.createElement(
            'span',
            { key: 'label', className: 'text-sm font-medium text-gray-700 dark:text-gray-300' },
            label
          ),
          React.createElement(
            'span',
            { key: 'value', className: 'text-sm font-semibold text-blue-600 dark:text-blue-400' },
            currentValue.toString()
          )
        ]
      ),
      React.createElement(
        'div',
        { key: 'slider-container', className: 'relative' },
        [
          // Track
          React.createElement(
            'div',
            {
              key: 'track',
              className: `
                h-3 rounded-full bg-gray-200 dark:bg-gray-700
                ${disabled ? 'opacity-50' : ''}
              `
            }
          ),
          // Filled track
          React.createElement(
            'div',
            {
              key: 'filled-track',
              className: `
                absolute top-0 left-0 h-3 rounded-full bg-blue-600 transition-all duration-150
                ${disabled ? 'opacity-50' : ''}
              `,
              style: { width: `${percentage}%` }
            }
          ),
          // Input
          React.createElement(
            'input',
            {
              key: 'input',
              type: 'range',
              min,
              max,
              value: currentValue,
              step,
              onChange: handleInputChange,
              onMouseDown: () => setIsDragging(true),
              onMouseUp: () => setIsDragging(false),
              onTouchStart: () => setIsDragging(true),
              onTouchEnd: () => setIsDragging(false),
              disabled,
              className: `
                absolute top-0 left-0 w-full h-3 opacity-0 cursor-pointer
                ${disabled ? 'cursor-not-allowed' : ''}
              `,
              style: { touchAction: 'none' }
            }
          ),
          // Thumb
          React.createElement(
            'div',
            {
              key: 'thumb',
              className: `
                absolute top-1/2 transform -translate-y-1/2 w-8 h-8 bg-white rounded-full shadow-lg border-2 border-blue-600 transition-all duration-150
                ${isDragging ? 'scale-110' : 'scale-100'}
                ${disabled ? 'opacity-50' : ''}
              `,
              style: { left: `calc(${percentage}% - 16px)` }
            }
          )
        ]
      )
    ]
  );
};

export { TouchButton, TouchCard, TouchInput, TouchSwitch, TouchSlider };
