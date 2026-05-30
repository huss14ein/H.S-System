import React from 'react';
import { useLanguage } from '../context/LanguageContext';

/** Compact EN/AR toggle for page headers and export rows. */
export const PageLanguageToggle: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { t, language, setLanguage } = useLanguage();
  return (
    <div className={`flex items-center gap-2 shrink-0 ${className}`}>
      <span className="text-xs font-semibold text-slate-500 hidden sm:inline">{t('language')}</span>
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
  );
};

export default PageLanguageToggle;
