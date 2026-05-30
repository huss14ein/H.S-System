import React, { useMemo } from 'react';
import { useMarketQuoteMeta } from '../../hooks/useMarketQuoteMeta';
import { useLanguage } from '../../context/LanguageContext';

export const QuotesAsOfBadge: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { isLive, symbolQuoteUpdatedAt, isRefreshing, hasQueuedPriceRefresh } = useMarketQuoteMeta();
  const { t, language } = useLanguage();

  const label = useMemo(() => {
    if (isRefreshing || hasQueuedPriceRefresh()) return t('quotesRefreshing');
    if (!isLive) return t('quotesCached');
    const stamps = Object.values(symbolQuoteUpdatedAt).filter(Boolean);
    if (stamps.length === 0) return t('quotesAwaiting');
    const latest = stamps.reduce((a, b) => (a > b ? a : b));
    const when = new Date(latest);
    if (Number.isNaN(when.getTime())) return t('quotesLive');
    return t('quotesAsOf').replace(
      '{time}',
      when.toLocaleTimeString(language === 'ar' ? 'ar-SA' : 'en-US', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    );
  }, [isLive, isRefreshing, hasQueuedPriceRefresh, symbolQuoteUpdatedAt, language, t]);

  const tone =
    isRefreshing || hasQueuedPriceRefresh()
      ? 'bg-sky-50 text-sky-800 border-sky-200'
      : isLive
        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
        : 'bg-amber-50 text-amber-900 border-amber-200';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tabular-nums ${tone} ${className}`}
      role="status"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isLive && !isRefreshing ? 'bg-emerald-500' : 'bg-amber-500'}`} />
      {label}
    </span>
  );
};

export default QuotesAsOfBadge;
