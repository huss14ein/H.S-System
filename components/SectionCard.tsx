import React, { ReactNode } from 'react';
import InfoHint from './InfoHint';

interface SectionCardProps {
  children: ReactNode;
  /** Section heading (optional) */
  title?: string;
  /** Optional icon before title */
  icon?: ReactNode;
  /** Short help text (?) next to title — use for engines, metrics, or non-obvious UI */
  infoHint?: string;
  /** Optional hint/tooltip or extra header content */
  headerAction?: ReactNode;
  /** If true, card has hover lift (for clickable cards) */
  hover?: boolean;
  /** Optional click handler (enables hover style) */
  onClick?: () => void;
  /** Extra class for the card container */
  className?: string;
}

/**
 * Consistent content card: white background, rounded corners, shadow, border.
 * Use for all major content sections to keep UI consistent.
 */
const SectionCard: React.FC<SectionCardProps> = ({
  children,
  title,
  icon,
  infoHint,
  headerAction,
  hover = false,
  onClick,
  className = '',
}) => {
  const cardClass = hover || onClick ? 'section-card-hover' : 'section-card';
  const content = (
    <>
      {(title || headerAction) && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 mb-4 min-w-0">
          {title && (
            <h2 className="section-title flex-1 min-w-0 flex flex-wrap items-center gap-1">
              {icon}
              <span className="inline-flex items-center gap-0.5">
                {title}
                {infoHint ? <InfoHint text={infoHint} /> : null}
              </span>
            </h2>
          )}
          {headerAction && <div className="flex-shrink-0">{headerAction}</div>}
        </div>
      )}
      {children}
    </>
  );

  if (onClick) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick())}
        className={`${cardClass} ${className}`}
      >
        {content}
      </div>
    );
  }

  return <div className={`${cardClass} ${className}`}>{content}</div>;
};

export default SectionCard;
