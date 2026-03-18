import React from 'react';

/** Displays a consistent "Managed: X" badge when owner is set. Use on account, asset, liability, portfolio, and commodity cards. */
interface OwnerBadgeProps {
  owner: string | null | undefined;
  /** Optional class for the wrapper (e.g. mt-1, mt-2). */
  className?: string;
}

const OwnerBadge: React.FC<OwnerBadgeProps> = ({ owner, className = '' }) => {
  const trimmed = owner?.trim();
  if (!trimmed) return null;
  return (
    <span
      className={`inline-flex items-center text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5 ${className}`}
      title="Excluded from My net worth — managed for this person"
    >
      Managed: {trimmed}
    </span>
  );
};

export default OwnerBadge;
