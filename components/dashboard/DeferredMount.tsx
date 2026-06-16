import React, { useEffect, useRef, useState, startTransition } from 'react';
import { scheduleIdleWork } from '../../utils/runWhenIdle';
import { SectionLoadingPlaceholder } from '../shared/SectionLoadingPlaceholder';

/** Mount children when near viewport — keeps below-fold dashboard suite off the critical path. */
export const DeferredMount: React.FC<{
  children: React.ReactNode;
  minHeight?: string;
  rootMargin?: string;
  /** After intersecting, wait idle + stagger before mounting (avoids main-thread spikes). */
  staggerIndex?: number;
  loadingLabelKey?: string;
}> = ({ children, minHeight = '8rem', rootMargin = '240px', staggerIndex = 0, loadingLabelKey = 'sectionLoading' }) => {
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
    const idleDelay = 48 + staggerIndex * 120;
    return scheduleIdleWork(() => {
      startTransition(() => setMounted(true));
    }, idleDelay);
  }, [intersecting, mounted, staggerIndex]);

  const visible = mounted;

  return (
    <div ref={ref} style={{ minHeight: visible ? undefined : minHeight }} className="min-w-0 w-full">
      {visible ? (
        children
      ) : (
        <SectionLoadingPlaceholder labelKey={loadingLabelKey} minHeight={minHeight} />
      )}
    </div>
  );
};
