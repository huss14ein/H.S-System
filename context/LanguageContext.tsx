import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type UiLanguage = 'en' | 'ar';
export type UiDir = 'ltr' | 'rtl';

const STORAGE_KEY = 'finova_ui_lang_v1';

type Dict = Record<string, { en: string; ar: string }>;

const DICT: Dict = {
  // Generic
  language: { en: 'Language', ar: 'اللغة' },
  english: { en: 'English', ar: 'الإنجليزية' },
  arabic: { en: 'Arabic', ar: 'العربية' },
  apply: { en: 'Apply', ar: 'تطبيق' },
  dateRange: { en: 'Date range', ar: 'النطاق الزمني' },
  lastUpdated: { en: 'Last updated', ar: 'آخر تحديث' },

  // Dashboard suite
  executiveStatus: { en: 'Executive status', ar: 'الملخص التنفيذي' },
  netWorth: { en: 'Net worth', ar: 'صافي الثروة' },
  liquidAssets: { en: 'Liquid assets', ar: 'الأصول السائلة' },
  investedCapital: { en: 'Invested capital', ar: 'رأس المال المستثمر' },
  cashflowTrend: { en: 'Cashflow trend', ar: 'اتجاه التدفقات النقدية' },
  inflow: { en: 'Inflow', ar: 'دخل' },
  outflow: { en: 'Outflow', ar: 'مصروف' },

  budgetIntel: { en: 'Budget & expense intelligence', ar: 'ذكاء الميزانية والمصروفات' },
  burnRate: { en: 'Burn rate', ar: 'معدل الصرف' },
  nearLimit: { en: 'Near limit', ar: 'قريب من الحد' },
  overLimit: { en: 'Over limit', ar: 'تجاوز الحد' },
  fixedVsVariable: { en: 'Fixed vs variable', ar: 'ثابت مقابل متغير' },
  spouse: { en: 'Spouse', ar: 'الزوج/الزوجة' },
  educationKids: { en: 'Education (kids)', ar: 'تعليم (الأطفال)' },

  investmentsAnalytics: { en: 'Investments & portfolio analytics', ar: 'تحليلات الاستثمار والمحفظة' },
  holdings: { en: 'Holdings', ar: 'المقتنيات' },
  shares: { en: 'Shares', ar: 'الأسهم' },
  avgEntry: { en: 'Avg entry', ar: 'متوسط الدخول' },
  marketPrice: { en: 'Market price', ar: 'سعر السوق' },
  roi: { en: 'ROI', ar: 'العائد' },
  gainLoss: { en: 'P/L', ar: 'الربح/الخسارة' },
  costAveraging: { en: 'Cost averaging calculator', ar: 'حاسبة متوسط التكلفة' },

  goalsForecast: { en: '2030 goals & forecasting', ar: 'أهداف 2030 والتوقعات' },
  progress: { en: 'Progress', ar: 'التقدم' },
  projection: { en: 'Projection', ar: 'توقع' },

  whatIf: { en: 'Decision sandbox (what-if)', ar: 'مختبر القرار (ماذا لو)' },
  allocationToInvestments: { en: 'Allocation to investments', ar: 'تخصيص للاستثمارات' },
  educationExpenseBump: { en: 'Education expenses (+%)', ar: 'زيادة مصروفات التعليم (+٪)' },

  dashboardCockpitTitle: { en: 'Monthly cockpit', ar: 'لوحة الشهر' },
  dashboardCockpitSubtitle: { en: 'Cashflow, budgets, and spending — your day-to-day financial pulse.', ar: 'التدفقات والميزانية والمصروفات — نبضك المالي اليومي.' },
  summaryAtlasTitle: { en: 'Wealth atlas', ar: 'خريطة الثروة' },
  summaryAtlasSubtitle: { en: 'How your net worth is built, allocated, and tracking toward 2030 — charts only on this page.', ar: 'كيف تُبنى ثروتك وتُوزَّع وتتجه نحو 2030 — رسوم بيانية خاصة بهذه الصفحة.' },
  wealthComposition: { en: 'Wealth composition', ar: 'تركيبة الثروة' },
  wealthCompositionHint: { en: 'Asset buckets that sum to headline net worth (same as Dashboard KPI).', ar: 'سلال الأصول التي تُجمع لصافي الثروة (نفس لوحة التحكم).' },
  allocationRings: { en: 'Allocation rings', ar: 'حلقات التوزيع' },
  holdingsMap: { en: 'Holdings heat map', ar: 'خريطة المقتنيات' },
  goalsRoadmapHint: { en: 'Milestone rings on the road to 2030.', ar: 'محطات على طريق 2030.' },
};

export type LanguageContextValue = {
  language: UiLanguage;
  dir: UiDir;
  setLanguage: (lang: UiLanguage) => void;
  t: (key: keyof typeof DICT | string) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

function normalizeLanguage(raw: unknown): UiLanguage {
  const v = String(raw ?? '').toLowerCase();
  return v === 'ar' ? 'ar' : 'en';
}

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<UiLanguage>(() => {
    try {
      return normalizeLanguage(localStorage.getItem(STORAGE_KEY));
    } catch {
      return 'en';
    }
  });

  const setLanguage = useCallback((lang: UiLanguage) => {
    setLanguageState(lang);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // ignore
    }
  }, []);

  const dir: UiDir = language === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    try {
      document.documentElement.lang = language;
      document.documentElement.dir = dir;
    } catch {
      // ignore
    }
  }, [language, dir]);

  const t = useCallback(
    (key: keyof typeof DICT | string) => {
      const row = (DICT as Record<string, { en: string; ar: string } | undefined>)[String(key)];
      if (!row) return String(key);
      return language === 'ar' ? row.ar : row.en;
    },
    [language],
  );

  const value = useMemo(() => ({ language, dir, setLanguage, t }), [language, dir, setLanguage, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}

