import React, { useEffect, useRef, useState, startTransition } from 'react';
import { scheduleIdleWork } from '../../utils/runWhenIdle';
import { isBackgroundWorkPaused } from '../../utils/backgroundWorkGate';

/** Mount children when near viewport — keeps below-fold dashboard suite off the critical path. */
export const DeferredMount: React.FC<{
  children: React.ReactNode;
  minHeight?: string;
  rootMargin?: string;
  /** After intersecting, wait idle + stagger before mounting (avoids main-thread spikes). */
  staggerIndex?: number;
}> = ({ children, minHeight = '8rem', rootMargin = '240px', staggerIndex = 0 }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [intersecting, setIntersecting] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (intersecting) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setIntersecting(true);
      return;
    }
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setIntersecting(true);
          obs.disconnect();
        }
      },
      { rootMargin },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [intersecting, rootMargin]);

  useEffect(() => {
    if (!intersecting || mounted) return;
    const idleDelay = 80 + staggerIndex * 320;
    return scheduleIdleWork(() => {
      if (isBackgroundWorkPaused()) return;
      startTransition(() => setMounted(true));
    }, idleDelay);
  }, [intersecting, mounted, staggerIndex]);

  const visible = mounted;

  return (
    <div ref={ref} style={{ minHeight: visible ? undefined : minHeight }}>
      {visible ? children : (
        <div
          className="h-full min-h-[inherit] rounded-2xl border border-slate-200 bg-slate-50/70 animate-pulse"
          aria-hidden
        />
      )}
    </div>
  );
};
