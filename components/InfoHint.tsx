import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useId } from 'react';
import { createPortal } from 'react-dom';
import { useSelfLearning } from '../context/SelfLearningContext';
import { INFOHINT_CLOSE_OTHERS } from './infoHintEvents';
import { InformationCircleIcon } from './icons/InformationCircleIcon';

interface InfoHintProps {
  text: string;
  /** When 'bottom', popover opens below the control. 'top' opens above (uses fixed positioning so it is not clipped by cards). */
  placement?: 'auto' | 'top' | 'bottom';
  /** Horizontal alignment of the popover relative to the info control. */
  popoverAlign?: 'left' | 'right';
  /** Optional: for self-learning. When user closes the hint, we record dismissal to show it less often. */
  hintId?: string;
  hintPage?: string;
}

/** Wide enough for full sentences; avoid clipping long registry hints. */
const PANEL_W = 320;
const GAP = 8;
/** Delay so the pointer can move from the trigger to the portaled panel without closing. */
const HOVER_CLOSE_MS = 400;
/** Avoid opening on accidental pointer sweep (scroll / fast moves across many (!) buttons). */
const HOVER_OPEN_DELAY_MS = 120;

const InfoHint: React.FC<InfoHintProps> = ({ text, placement = 'auto', popoverAlign = 'left', hintId, hintPage }) => {
  const hasText = String(text ?? '').trim().length > 0;
  const tooltipId = useId();
  const instanceId = `hint-${tooltipId}`;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});
  const { trackHintDismissed } = useSelfLearning();

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
    }, HOVER_CLOSE_MS);
  }, [clearCloseTimer]);

  const openPanel = useCallback(() => {
    clearCloseTimer();
    clearOpenTimer();
    window.dispatchEvent(new CustomEvent(INFOHINT_CLOSE_OTHERS, { detail: { except: instanceId } }));
    setOpen(true);
  }, [clearCloseTimer, clearOpenTimer, instanceId]);

  const scheduleOpenFromHover = useCallback(() => {
    clearCloseTimer();
    clearOpenTimer();
    window.dispatchEvent(new CustomEvent(INFOHINT_CLOSE_OTHERS, { detail: { except: instanceId } }));
    openTimerRef.current = setTimeout(() => {
      openTimerRef.current = null;
      setOpen(true);
    }, HOVER_OPEN_DELAY_MS);
  }, [clearCloseTimer, clearOpenTimer, instanceId]);

  /** Avoid closing on mouse-leave while the trigger stays focused (panel is portaled outside the trigger subtree). */
  const handleTriggerPointerLeave = useCallback(() => {
    clearOpenTimer();
    if (triggerRef.current && document.activeElement === triggerRef.current) return;
    scheduleClose();
  }, [clearOpenTimer, scheduleClose]);

  useEffect(() => {
    const onOthers = (e: Event) => {
      const except = (e as CustomEvent<{ except?: string }>).detail?.except;
      if (except !== instanceId) {
        clearOpenTimer();
        setOpen(false);
      }
    };
    window.addEventListener(INFOHINT_CLOSE_OTHERS, onOthers);
    return () => window.removeEventListener(INFOHINT_CLOSE_OTHERS, onOthers);
  }, [instanceId, clearOpenTimer]);

  useEffect(() => () => {
    clearCloseTimer();
    clearOpenTimer();
  }, [clearCloseTimer, clearOpenTimer]);

  const positionPanel = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const panelW = Math.min(PANEL_W, window.innerWidth - 16);
    let left = popoverAlign === 'right' ? r.right - panelW : r.left;
    left = Math.max(GAP, Math.min(left, window.innerWidth - panelW - GAP));

    const showBelow = placement !== 'top';
    if (showBelow) {
      setPanelStyle({
        position: 'fixed',
        top: r.bottom + GAP,
        left,
        width: panelW,
        maxHeight: 'min(36rem, 82vh)',
      });
    } else {
      setPanelStyle({
        position: 'fixed',
        left,
        width: panelW,
        maxHeight: 'min(36rem, 82vh)',
        top: r.top - GAP,
        transform: 'translateY(-100%)',
      });
    }
  }, [placement, popoverAlign]);

  useLayoutEffect(() => {
    if (!open) return;
    positionPanel();
    const onScrollOrResize = () => positionPanel();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, positionPanel]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      if (hintId && hintPage) trackHintDismissed(hintId, hintPage);
      setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, hintId, hintPage, trackHintDismissed]);

  const stopParent = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    clearOpenTimer();
    clearCloseTimer();
    setOpen((v) => {
      if (!v) {
        window.dispatchEvent(new CustomEvent(INFOHINT_CLOSE_OTHERS, { detail: { except: instanceId } }));
        return true;
      }
      if (hintId && hintPage) trackHintDismissed(hintId, hintPage);
      return false;
    });
  };

  const panel = open ? (
    <div
      id={tooltipId}
      ref={panelRef}
      style={panelStyle}
      className="z-[10000] overflow-y-auto rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-xl leading-relaxed whitespace-normal break-words text-left pointer-events-auto"
      role="tooltip"
      onClick={stopParent}
      onMouseDown={stopParent}
      onMouseEnter={openPanel}
      onMouseLeave={scheduleClose}
    >
      {text}
    </div>
  ) : null;

  if (!hasText) return null;

  return (
    <span
      data-infohint-trigger="true"
      className="infohint-trigger relative z-[100] inline-flex h-4 w-4 shrink-0 items-center justify-center align-middle leading-none self-center"
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        onMouseDown={stopParent}
        onMouseEnter={scheduleOpenFromHover}
        onMouseLeave={handleTriggerPointerLeave}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse' || e.pointerType === 'pen') scheduleOpenFromHover();
        }}
        className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-slate-400 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 touch-manipulation"
        aria-label="More information"
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
      >
        <InformationCircleIcon className="h-4 w-4" aria-hidden="true" />
      </button>
      {typeof document !== 'undefined' && panel ? createPortal(panel, document.body) : null}
    </span>
  );
};

export default InfoHint;
