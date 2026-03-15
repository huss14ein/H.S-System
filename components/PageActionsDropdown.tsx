import React, { useRef } from 'react';

export interface PageActionItem {
  value: string;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}

export interface PageActionsDropdownProps {
  /** List of actions. When 3+ page-level actions exist, use this component for consistency. */
  actions: PageActionItem[];
  /** Label before the dropdown (default: "Actions") */
  label?: string;
  /** Placeholder option text (default: "Choose action…") */
  placeholder?: string;
  /** Optional class for the wrapper */
  className?: string;
  /** Optional aria-label for the select */
  ariaLabel?: string;
}

/**
 * Standard dropdown for page-level actions when a page has 3 or more actions.
 * Use this across all pages so "Actions: Choose action…" is consistent.
 */
const PageActionsDropdown: React.FC<PageActionsDropdownProps> = ({
  actions,
  label = 'Actions',
  placeholder = 'Choose action…',
  className = '',
  ariaLabel = 'Page actions',
}) => {
  const selectRef = useRef<HTMLSelectElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    if (!v) return;
    const item = actions.find((a) => a.value === v);
    if (item && !item.disabled) {
      item.onClick();
    }
    e.target.value = '';
    if (selectRef.current) selectRef.current.value = '';
  };

  if (actions.length === 0) return null;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <label className="text-xs text-slate-500 font-medium whitespace-nowrap">{label}:</label>
      <select
        ref={selectRef}
        className="p-2 border border-slate-300 rounded-lg text-sm bg-white min-w-[180px]"
        value=""
        onChange={handleChange}
        aria-label={ariaLabel}
      >
        <option value="">{placeholder}</option>
        {actions.map((a) => (
          <option key={a.value} value={a.value} disabled={a.disabled}>
            {a.label}
          </option>
        ))}
      </select>
    </div>
  );
};

export default PageActionsDropdown;
