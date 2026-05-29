import React from 'react';
import { useLanguage } from '../../context/LanguageContext';

export const DashboardSectionHeader: React.FC<{
  titleKey: string;
  subtitleKey: string;
}> = ({ titleKey, subtitleKey }) => {
  const { t, dir, language, setLanguage } = useLanguage();
  return (
    <div dir={dir} className="flex flex-wrap items-end justify-between gap-3 pb-1">
      <div>
        <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900">{t(titleKey)}</h2>
        <p className="mt-1 text-sm text-slate-600 max-w-prose">{t(subtitleKey)}</p>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-slate-500">{t('language')}</span>
        <div className="rounded-full border border-slate-200 bg-white p-1 shadow-sm" dir="ltr">
          <button
            type="button"
            onClick={() => setLanguage('en')}
            className={`px-3 py-1 text-xs font-semibold rounded-full transition-colors ${
              language === 'en' ? 'bg-primary text-white' : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            EN
          </button>
          <button
            type="button"
            onClick={() => setLanguage('ar')}
            className={`px-3 py-1 text-xs font-semibold rounded-full transition-colors ${
              language === 'ar' ? 'bg-primary text-white' : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            AR
          </button>
        </div>
      </div>
    </div>
  );
};
