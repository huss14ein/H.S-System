import React, { ReactNode, useState } from 'react';
import InfoHint from './InfoHint';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { ChevronUpIcon } from './icons/ChevronUpIcon';
import { resolveSectionInfoHint, type SectionHintPreset } from '../content/sectionInfoHints';

interface SectionCardProps {
  children: ReactNode;
  /** Section heading (optional) */
  title?: string;
  /** Optional icon before title */
  icon?: ReactNode;
  /** Short help text (?) next to title — overrides registry when set */
  infoHint?: string;
  /** Lookup in `content/sectionInfoHints.ts` (semantic key or normalized title) */
  infoHintKey?: string;
  /** Preset blurb when no title-specific copy exists */
  hintPreset?: SectionHintPreset;
  /** Hide the (!) hint entirely */
  noHint?: boolean;
  /** When true (default), titled sections without registry copy get the default one-liner */
  autoHint?: boolean;
  /** Optional hint/tooltip or extra header content */
  headerAction?: ReactNode;
  /** If true, card has hover lift (for clickable cards) */
  hover?: boolean;
  /** Optional click handler (enables hover style) */
  onClick?: () => void;
  /** Extra class for the card container */
  className?: string;
  /** Optional id for anchor/jump links */
  id?: string;
  /** When true, section is collapsible to reduce clutter */
  collapsible?: boolean;
  /** One-line summary shown when collapsed (use with collapsible) */
  collapsibleSummary?: string;
  /** Start expanded when collapsible (default: false) */
  defaultExpanded?: boolean;
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
  infoHintKey,
  hintPreset,
  noHint,
  autoHint = true,
  headerAction,
  hover = false,
  onClick,
  className = '',
  id,
  collapsible = false,
  collapsibleSummary,
  defaultExpanded = false,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const cardClass = hover || onClick ? 'section-card-hover' : 'section-card';
  const resolvedHint = resolveSectionInfoHint({
    title,
    infoHint,
    infoHintKey,
    hintPreset,
    noHint,
    autoHint,
  });

  const headerContent = (title || headerAction) && (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 mb-4 min-w-0">
      {title && (
        <h2 className="section-title flex-1 min-w-0 flex flex-wrap items-center gap-1">
          {icon}
          <span className="inline-flex items-center gap-0.5">
            {title}
            {resolvedHint ? <InfoHint text={resolvedHint} /> : null}
          </span>
        </h2>
      )}
      {headerAction && <div className="flex-shrink-0">{headerAction}</div>}
    </div>
  );

  const content = (
    <>
      {collapsible && title ? (
        <div className="flex items-center justify-between gap-2 w-full rounded-lg -m-1 p-1 min-w-0 hover:bg-slate-50/80 transition-colors">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="flex items-center gap-2 min-w-0 flex-1 text-left py-1 pr-1 cursor-pointer rounded-lg"
            aria-expanded={expanded}
          >
            {icon}
            <h2 className="section-title text-base font-semibold text-slate-800 truncate">{title}</h2>
            {collapsibleSummary && !expanded && (
              <span className="hidden sm:inline text-sm text-slate-500 truncate ml-1">— {collapsibleSummary}</span>
            )}
          </button>
          <div className="flex items-center gap-1 shrink-0">
            {resolvedHint ? <InfoHint text={resolvedHint} popoverAlign="right" /> : null}
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="flex-shrink-0 p-1 rounded text-slate-400 hover:text-slate-600"
              aria-expanded={expanded}
              aria-label={expanded ? 'Collapse section' : 'Expand section'}
            >
              {expanded ? <ChevronUpIcon className="h-5 w-5" /> : <ChevronDownIcon className="h-5 w-5" />}
            </button>
          </div>
        </div>
      ) : (
        headerContent
      )}
      {(!collapsible || expanded) && (
        <div className={collapsible ? 'pt-3 mt-1 border-t border-slate-100' : undefined}>
          {collapsible && headerAction ? <div className="mb-2">{headerAction}</div> : null}
          {children}
        </div>
      )}
    </>
  );

  const wrapperProps = { id, className: `${cardClass} ${className}` };
  if (onClick && !collapsible) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick())}
        {...wrapperProps}
      >
        {content}
      </div>
    );
  }

  return <div {...wrapperProps}>{content}</div>;
};

export default SectionCard;
