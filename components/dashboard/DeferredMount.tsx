import React, { useEffect, useRef, useState } from 'react';

/** Mount children when near viewport — keeps below-fold dashboard suite off the critical path. */
export const DeferredMount: React.FC<{
  children: React.ReactNode;
  minHeight?: string;
  rootMargin?: string;
}> = ({ children, minHeight = '8rem', rootMargin = '240px' }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [visible, rootMargin]);

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
