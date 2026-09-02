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
  executiveStatusSubtitle: {
    en: 'Headline net worth, liquid cash, and invested capital — same canonical path as Dashboard KPIs.',
    ar: 'صافي الثروة والنقد السائل ورأس المال المستثمر — نفس مسار لوحة التحكم.',
  },
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
  dashboardCockpitSubtitle: {
    en: 'Cashflow, budgets, and spending — use the range control to focus every chart below.',
    ar: 'التدفقات والميزانية والمصروف — اختر النطاق الزمني لتركيز كل المخططات أدناه.',
  },
  summaryAtlasTitle: { en: 'Wealth atlas', ar: 'خريطة الثروة' },
  summaryAtlasSubtitle: { en: 'How your net worth is built, allocated, and tracking toward 2030 — charts only on this page.', ar: 'كيف تُبنى ثروتك وتُوزَّع وتتجه نحو 2030 — رسوم بيانية خاصة بهذه الصفحة.' },
  wealthComposition: { en: 'Wealth composition', ar: 'تركيبة الثروة' },
  wealthCompositionHint: { en: 'Asset buckets that sum to headline net worth (same as Dashboard KPI).', ar: 'سلال الأصول التي تُجمع لصافي الثروة (نفس لوحة التحكم).' },
  allocationRings: { en: 'Allocation rings', ar: 'حلقات التوزيع' },
  holdingsMap: { en: 'Holdings heat map', ar: 'خريطة المقتنيات' },
  goalsRoadmapHint: { en: 'Milestone rings on the road to 2030.', ar: 'محطات على طريق 2030.' },
  analyticsHoldingsTitle: { en: 'Holdings & calculators', ar: 'المقتنيات والحاسبات' },
  analyticsHoldingsSubtitle: {
    en: 'One portfolio at a time — position ROI with live quotes, same SAR/USD rate as the Investments hub.',
    ar: 'محفظة واحدة في كل مرة — عائد كل مركز بأسعار مباشرة، نفس سعر الصرف كمركز الاستثمار.',
  },
  analyticsResilienceTitle: { en: 'Resilience & liquid wealth', ar: 'المرونة والثروة السائلة' },
  analyticsResilienceSubtitle: {
    en: 'Spendable-style wealth, runway, stress tests — canonical numbers from the wealth summary model.',
    ar: 'ثروة قابلة للصرف، مدى السيولة، اختبارات الضغط — أرقام موحدة من نموذج الملخص.',
  },
  portfolioPeriodPnLTitle: { en: 'Portfolio P/L scoreboard', ar: 'لوحة ربح/خسارة المحافظ' },
  portfolioPeriodPnLSubtitle: {
    en: 'Weekly (last 7 days) and financial-month P/L per portfolio — same ledger rules as Investments.',
    ar: 'ربح/خسارة أسبوعية (آخر 7 أيام) وشهر مالي لكل محفظة — نفس قواعد دفتر الاستثمار.',
  },
  portfolioPeriodPnLHint: {
    en: 'Total = end live value − start-of-period cost snapshot − net attributed deposits/withdrawals (cash included; siblings share broker cash by position weight). Seeded books reconstruct start cash so in-period buys are not counted as gains. Ledger = realized sells, dividends, fees. Market = remainder.',
    ar: 'المجموع = القيمة الحية − لقطة تكلفة بداية الفترة − صافي الإيداعات/السحوبات المنسوبة (يشمل النقد). الدفاتر المستوردة تعيد بناء نقد البداية حتى لا تُحسب المشتريات كأرباح. الدفتر = مبيعات وأرباح ورسوم. السوق = الباقي.',
  },
  portfolioPeriodPnLEmpty: {
    en: 'Add investment portfolios to see weekly and monthly P/L here.',
    ar: 'أضف محافظ استثمارية لعرض الربح/الخسارة الأسبوعية والشهرية هنا.',
  },
  portfolioLabel: { en: 'Portfolio', ar: 'المحفظة' },
  weekPnL: { en: 'Week P/L', ar: 'أسبوع' },
  monthPnL: { en: 'Month P/L', ar: 'الشهر' },
  monthlyPnLKpi: { en: 'Monthly P/L', ar: 'ربح/خسارة الشهر' },
  weeklyPnLKpi: { en: 'Weekly P/L', ar: 'ربح/خسارة الأسبوع' },
  todayPnL: { en: 'Today', ar: 'اليوم' },
  weekLedgerShort: { en: 'Week · ledger', ar: 'أسبوع · دفتر' },
  weekMarketShort: { en: 'Week · market est.', ar: 'أسبوع · سوق' },
  monthLedgerShort: { en: 'Month · ledger', ar: 'شهر · دفتر' },
  monthMarketShort: { en: 'Month · market est.', ar: 'شهر · سوق' },
  openInvestmentsHub: { en: 'Open Investments hub', ar: 'فتح مركز الاستثمار' },
  weekPnLTrendTitle: { en: 'Week P/L trend', ar: 'اتجاه الربح/الخسارة الأسبوعي' },
  weekPnLTrendSubtitle: { en: 'Cumulative last 7 days — mark-to-market from period start', ar: 'تراكمي آخر 7 أيام — تقييم السوق من بداية الفترة' },
  monthPnLTrendTitle: { en: 'Month P/L trend', ar: 'اتجاه الربح/الخسارة الشهري' },
  monthPnLTrendSubtitle: { en: 'Cumulative financial month — same mark-to-market rules as Investments', ar: 'تراكمي للشهر المالي — نفس قواعد تقييم السوق في الاستثمار' },
  executiveKpiGridTitle: { en: 'Executive KPIs', ar: 'مؤشرات تنفيذية' },
  executiveKpiGridSubtitle: {
    en: 'Net worth, monthly & weekly P/L, ROI, budget, emergency fund — same canonical engine as Dashboard.',
    ar: 'صافي الثروة وربح/خسارة الشهر والأسبوع والعائد والميزانية وصندوق الطوارئ — نفس محرك لوحة التحكم.',
  },
  emergencyFund: { en: 'Emergency fund', ar: 'صندوق الطوارئ' },
  budgetVariance: { en: 'Budget variance', ar: 'انحراف الميزانية' },
  investmentRoi: { en: 'Investment ROI', ar: 'عائد الاستثمار' },
  presentValue: { en: 'Present value', ar: 'القيمة الحالية' },
  netInvested: { en: 'Net invested', ar: 'صافي المستثمر' },
  investmentGrowth: { en: 'Growth', ar: 'النمو' },
  timeInvested: { en: 'Time invested', ar: 'مدة الاستثمار' },
  principalRecovered: { en: 'Principal recovered', ar: 'استرداد رأس المال' },
  growingVsNetInvested: { en: 'Growing vs net invested', ar: 'ينمو مقابل صافي المستثمر' },
  shrinkingVsNetInvested: { en: 'Shrinking vs net invested', ar: 'يتراجع مقابل صافي المستثمر' },
  kpiTarget: { en: 'Target', ar: 'الهدف' },
  kpiTargetMonthStart: { en: 'Month start (implied)', ar: 'بداية الشهر (مستنتج)' },
  kpiTargetBreakEven: { en: 'Break-even', ar: 'التعادل' },
  kpiTargetOnBudget: { en: 'On budget', ar: 'ضمن الميزانية' },
  kpiTargetEfCash: { en: 'EF cash target', ar: 'هدف نقد الطوارئ' },
  kpiMonthsShort: { en: 'mo', ar: 'شهر' },
  kpiStatusOnTrack: { en: 'On track', ar: 'على المسار' },
  kpiStatusWatch: { en: 'Watch', ar: 'مراقبة' },
  kpiStatusSurplus: { en: 'Surplus', ar: 'فائض' },
  kpiStatusDeficit: { en: 'Deficit', ar: 'عجز' },
  kpiStatusFunded: { en: 'Funded', ar: 'ممول' },
  kpiStatusBuilding: { en: 'Building', ar: 'قيد البناء' },
  kpiStatusGap: { en: 'Gap', ar: 'فجوة' },
  kpiStatusUnderBudget: { en: 'Under budget', ar: 'أقل من الميزانية' },
  kpiStatusOverBudget: { en: 'Over budget', ar: 'فوق الميزانية' },
  kpiStatusGain: { en: 'Gain', ar: 'ربح' },
  kpiStatusLoss: { en: 'Loss', ar: 'خسارة' },
  kpiStatusFlat: { en: 'Flat', ar: 'ثابت' },
  kpiStatusLiquid: { en: 'Liquid', ar: 'سائل' },
  wealthHealthStripTitle: { en: 'Wealth health indicators', ar: 'مؤشرات صحة الثروة' },
  healthStripSubtitle: {
    en: 'Discipline, liquidity runway, and allocation concentration at a glance.',
    ar: 'الانضباط ومدى السيولة وتركّز التوزيع في لمحة.',
  },
  healthAtRisk: { en: 'At risk', ar: 'معرّض للخطر' },
  healthDiscipline: { en: 'Discipline', ar: 'الانضباط' },
  healthDisciplineDetail: { en: 'Budget adherence score', ar: 'درجة الالتزام بالميزانية' },
  healthRunway: { en: 'Runway', ar: 'مدى السيولة' },
  healthRunwayDetail: { en: 'Months of liquid runway', ar: 'أشهر السيولة المتاحة' },
  healthRunwayBurn: { en: 'Burn', ar: 'الإنفاق' },
  healthAllocation: { en: 'Allocation', ar: 'التوزيع' },
  healthAllocationDetail: { en: 'Largest asset-class slice', ar: 'أكبر شريحة فئة أصول' },
  healthTopSlice: { en: 'top slice', ar: 'أعلى شريحة' },
  healthBudgetDrift: { en: 'budget drift', ar: 'انحراف ميزانية' },
  quotesAsOf: { en: 'Quotes as of {time}', ar: 'أسعار اعتباراً من {time}' },
  quotesLive: { en: 'Live quotes', ar: 'أسعار مباشرة' },
  quotesCached: { en: 'Cached quotes', ar: 'أسعار مخزنة' },
  quotesAwaiting: { en: 'Awaiting quote refresh', ar: 'بانتظار تحديث الأسعار' },
  quotesRefreshing: { en: 'Refreshing quotes…', ar: 'جاري تحديث الأسعار…' },
  portfolioDetailsTable: { en: 'Portfolio breakdown', ar: 'تفصيل المحافظ' },
  exportLabel: { en: 'Export', ar: 'تصدير' },
  exportChoose: { en: 'Choose export…', ar: 'اختر تصدير…' },
  exportExecutiveSummary: { en: 'Executive summary (PDF)', ar: 'ملخص تنفيذي (PDF)' },
  exportPassportPrefix: { en: 'Passport:', ar: 'جواز:' },
  analyticsDetailsTitle: { en: 'Details & insights', ar: 'التفاصيل والرؤى' },
  analyticsDetailsSummary: { en: 'Resilience, suggested actions, AI — expand when needed', ar: 'المرونة، الإجراءات، الذكاء — وسّع عند الحاجة' },
  syncingWorkspace: { en: 'Syncing workspace…', ar: 'جاري مزامنة مساحة العمل…' },
  analyticsMetricsLoading: {
    en: 'Computing allocation, health metrics, and export data (canonical engine)…',
    ar: 'جاري حساب التوزيع ومؤشرات الصحة وبيانات التصدير (المحرك الموحد)…',
  },
  analyticsSectionLoading: { en: 'Loading section…', ar: 'جاري تحميل القسم…' },
  analyticsHealthLoading: { en: 'Loading wealth health indicators…', ar: 'جاري تحميل مؤشرات صحة الثروة…' },
  analyticsAtlasLoading: { en: 'Loading wealth atlas charts…', ar: 'جاري تحميل مخططات أطلس الثروة…' },
  sectionLoading: { en: 'Loading…', ar: 'جاري التحميل…' },

  // Sukuk payout schedule modal (Investments → Sukuk)
  sukukPayoutHowPaid: { en: 'How are you paid?', ar: 'كيف تُدفع لك؟' },
  sukukPayoutIntro: {
    en: 'Tell Finova when profit and capital come back so cash and outstanding balance stay accurate.',
    ar: 'أخبر فينوفا متى يعود الربح ورأس المال حتى يبقى النقد والرصيد المستحق دقيقاً.',
  },
  sukukPayoutNextScheduled: { en: 'Next scheduled', ar: 'القادم المجدول' },
  sukukPayoutCashLandsIn: { en: 'Cash lands in', ar: 'يودع النقد في' },
  sukukPayoutChooseAccount: { en: 'Choose investment account…', ar: 'اختر حساب الاستثمار…' },
  sukukPayoutAccountAria: {
    en: 'Investment account that receives payouts',
    ar: 'حساب الاستثمار الذي يستلم الدفعات',
  },
  sukukPayoutAccountHint: {
    en: 'Usually the same platform account mapped to this Sukuk.',
    ar: 'عادةً نفس حساب المنصة المرتبط بهذا الصك.',
  },
  sukukPayoutFrequency: { en: 'Payment frequency', ar: 'تكرار الدفع' },
  sukukPayoutPaymentDay: { en: 'Payment day each period', ar: 'يوم الدفع في كل فترة' },
  sukukPayoutPaymentDayHint: {
    en: 'Day of the month from 1–28 (e.g. 25).',
    ar: 'يوم من الشهر بين 1–28 (مثل 25).',
  },
  sukukPayoutProfitEach: { en: 'Profit each payment ({currency})', ar: 'الربح في كل دفعة ({currency})' },
  sukukPayoutProfitMaturity: {
    en: 'Profit at maturity ({currency}, optional)',
    ar: 'الربح عند الاستحقاق ({currency}، اختياري)',
  },
  sukukPayoutProfitEachHint: {
    en: 'The regular profit amount you expect each period.',
    ar: 'مبلغ الربح المنتظم المتوقع لكل فترة.',
  },
  sukukPayoutProfitMaturityHint: {
    en: 'Leave blank if profit is already included in the final payout, or enter the profit portion separately.',
    ar: 'اتركه فارغاً إذا كان الربح مضمّناً في الدفعة النهائية، أو أدخل جزء الربح بشكل منفصل.',
  },
  sukukPayoutCapitalEach: {
    en: 'Capital returned each payment ({currency}, optional)',
    ar: 'رأس المال المُسترد في كل دفعة ({currency}، اختياري)',
  },
  sukukPayoutCapitalEachHint: {
    en: 'Only if part of your invested capital comes back with each payment. Leave 0 if you only receive profit until maturity.',
    ar: 'فقط إذا عاد جزء من رأس مالك المستثمر مع كل دفعة. اترك 0 إذا كنت تستلم الربح فقط حتى الاستحقاق.',
  },
  sukukPayoutCapitalMaturity: {
    en: 'Capital at maturity ({currency})',
    ar: 'رأس المال عند الاستحقاق ({currency})',
  },
  sukukPayoutCapitalMaturityPlaceholder: {
    en: 'Leave blank for remaining balance',
    ar: 'اتركه فارغاً للرصيد المتبقي',
  },
  sukukPayoutCapitalMaturityHint: {
    en: 'Leave blank to return whatever outstanding capital is left on {date}.',
    ar: 'اتركه فارغاً لإرجاع ما تبقى من رأس المال المستحق في {date}.',
  },
  sukukPayoutMaturityFallback: { en: 'maturity', ar: 'الاستحقاق' },
  sukukPayoutSummary: { en: 'Summary', ar: 'الملخص' },
  sukukPayoutSave: { en: 'Save payout schedule', ar: 'حفظ جدول الدفع' },
  sukukPayoutSaving: { en: 'Saving…', ar: 'جاري الحفظ…' },
  sukukPayoutChooseAccountError: {
    en: 'Choose which investment account receives the cash.',
    ar: 'اختر حساب الاستثمار الذي يستلم النقد.',
  },
  sukukPayoutSaveFailed: { en: 'Failed to save schedule.', ar: 'تعذّر حفظ الجدول.' },
  sukukPayoutSetHowPaid: { en: 'Set how you are paid', ar: 'حدد كيف تُدفع لك' },
  sukukPayoutEditHowPaid: { en: 'Edit how you are paid', ar: 'تعديل كيف تُدفع لك' },
  sukukPayoutCorrectOutstanding: { en: 'Correct outstanding', ar: 'تصحيح المستحق' },
  sukukPayoutNextPayout: { en: 'Next payout', ar: 'الدفعة القادمة' },
  sukukPayoutSummaryOnDay: { en: 'on day {day}', ar: 'في اليوم {day}' },
  sukukPayoutSummaryProfitEach: {
    en: '{amount} {currency} profit each payment',
    ar: '{amount} {currency} ربح لكل دفعة',
  },
  sukukPayoutSummaryProfitMaturity: {
    en: '{amount} {currency} profit at maturity',
    ar: '{amount} {currency} ربح عند الاستحقاق',
  },
  sukukPayoutSummaryCapitalEach: {
    en: '{amount} {currency} capital each payment',
    ar: '{amount} {currency} رأس مال لكل دفعة',
  },
  sukukPayoutSummaryCapitalMaturity: {
    en: '{amount} {currency} capital at maturity',
    ar: '{amount} {currency} رأس مال عند الاستحقاق',
  },
  sukukPayoutSummaryRemainingCapital: {
    en: 'remaining capital at maturity',
    ar: 'رأس المال المتبقي عند الاستحقاق',
  },

  // Sukuk Investments section + contract modal + correct-outstanding
  sukukSectionTitle: { en: 'Direct Sukuk contracts', ar: 'عقود الصكوك المباشرة' },
  sukukSectionSubtitle: {
    en: 'Off-platform Sukuk with maturity dates and a simple payout schedule. Broker Sukuk funds use Record Trade with asset class Sukuk.',
    ar: 'صكوك خارج المنصة بتاريخ استحقاق وجدول دفع بسيط. صناديق الصكوك لدى الوسطاء تُسجَّل عبر تسجيل صفقة بفئة أصول صكوك.',
  },
  sukukFilterActive: { en: 'Active', ar: 'نشط' },
  sukukFilterCompleted: { en: 'Completed', ar: 'مكتمل' },
  sukukFilterAll: { en: 'All', ar: 'الكل' },
  sukukAdd: { en: 'Add Sukuk', ar: 'إضافة صك' },
  sukukEmpty: { en: 'No Sukuk contracts in this view.', ar: 'لا توجد عقود صكوك في هذا العرض.' },
  sukukEmptyCompletedHint: {
    en: '{count} completed or matured contract(s) — switch to All or Completed.',
    ar: '{count} عقد مكتمل أو منتهٍ — انتقل إلى الكل أو مكتمل.',
  },
  sukukEmptyTryAll: {
    en: 'Try switching to All to see every contract.',
    ar: 'جرّب التبديل إلى الكل لعرض كل العقود.',
  },
  sukukOutstanding: { en: 'Outstanding', ar: 'المستحق' },
  sukukFaceValue: { en: 'Face value', ar: 'القيمة الاسمية' },
  sukukEditAria: { en: 'Edit', ar: 'تعديل' },
  sukukDeleteAria: { en: 'Delete', ar: 'حذف' },
  sukukStatusActive: { en: 'Active', ar: 'نشط' },
  sukukStatusCompleted: { en: 'Completed', ar: 'مكتمل' },
  sukukAddContract: { en: 'Add Sukuk contract', ar: 'إضافة عقد صك' },
  sukukEditContract: { en: 'Edit Sukuk contract', ar: 'تعديل عقد صك' },
  sukukContractIntro: {
    en: 'Direct Sukuk contracts live under Investments (not Assets). For broker-held Sukuk funds, use Record Trade with asset class Sukuk.',
    ar: 'عقود الصكوك المباشرة ضمن الاستثمارات (وليست الأصول). لصناديق الصكوك لدى الوسطاء استخدم تسجيل صفقة بفئة أصول صكوك.',
  },
  sukukContractName: { en: 'Contract name', ar: 'اسم العقد' },
  sukukContractNamePlaceholder: {
    en: 'e.g. Government Sukuk 2027',
    ar: 'مثال: صكوك حكومية 2027',
  },
  sukukInvestmentAccount: { en: 'Investment account', ar: 'حساب الاستثمار' },
  sukukChoosePlatformAccount: { en: 'Choose platform account…', ar: 'اختر حساب المنصة…' },
  sukukCurrency: { en: 'Currency', ar: 'العملة' },
  sukukFaceValueOriginal: {
    en: 'Face value (original capital)',
    ar: 'القيمة الاسمية (رأس المال الأصلي)',
  },
  sukukFaceLockedHint: {
    en: 'Face value and outstanding balance are locked after create — use Correct outstanding for audited corrections.',
    ar: 'القيمة الاسمية والرصيد المستحق مقفولان بعد الإنشاء — استخدم تصحيح المستحق للتعديلات المدققة.',
  },
  sukukPurchasePrice: { en: 'Purchase price (optional)', ar: 'سعر الشراء (اختياري)' },
  sukukIssueDate: { en: 'Issue date', ar: 'تاريخ الإصدار' },
  sukukMaturityDate: { en: 'Maturity date', ar: 'تاريخ الاستحقاق' },
  sukukLinkedGoal: { en: 'Linked goal (optional)', ar: 'هدف مرتبط (اختياري)' },
  sukukNoGoalLink: { en: 'No goal link', ar: 'بدون ربط بهدف' },
  sukukNotesOptional: { en: 'Notes (optional)', ar: 'ملاحظات (اختياري)' },
  sukukSave: { en: 'Save Sukuk', ar: 'حفظ الصك' },
  sukukFaceValueError: {
    en: 'Face value must be a non-negative number.',
    ar: 'يجب أن تكون القيمة الاسمية رقماً غير سالب.',
  },
  sukukChooseAccountError: {
    en: 'Choose the mapped investment platform account.',
    ar: 'اختر حساب منصة الاستثمار المرتبط.',
  },
  sukukDatesRequiredError: {
    en: 'Issue and maturity dates are required.',
    ar: 'تاريخا الإصدار والاستحقاق مطلوبان.',
  },
  sukukSaveFailed: { en: 'Failed to save Sukuk.', ar: 'تعذّر حفظ الصك.' },
  sukukCorrectFailed: {
    en: 'Could not correct Sukuk outstanding balance.',
    ar: 'تعذّر تصحيح رصيد الصك المستحق.',
  },

  // Shared revaluation / correct-outstanding modal
  revalCurrentBook: { en: 'Current book', ar: 'القيمة الدفترية الحالية' },
  revalDelta: { en: 'Delta', ar: 'الفرق' },
  revalNewValue: { en: 'New value ({currency})', ar: 'القيمة الجديدة ({currency})' },
  revalReason: { en: 'Reason (required)', ar: 'السبب (مطلوب)' },
  revalReasonPlaceholder: { en: 'e.g. Annual appraisal', ar: 'مثال: تقييم سنوي' },
  revalCancel: { en: 'Cancel', ar: 'إلغاء' },
  revalApplying: { en: 'Applying…', ar: 'جاري التطبيق…' },
  revalAlreadyMatches: { en: 'Already matches', ar: 'مطابق بالفعل' },
  revalApply: { en: 'Apply revaluation', ar: 'تطبيق إعادة التقييم' },
  revalReasonError: {
    en: 'Reason is required (at least 3 characters).',
    ar: 'السبب مطلوب (3 أحرف على الأقل).',
  },
  revalInvalidValue: { en: 'Enter a valid value.', ar: 'أدخل قيمة صحيحة.' },
  revalSukukIntro: {
    en: 'correcting the outstanding balance updates Sukuk exposure and net worth. Posted payouts stay; only unposted future payouts are rebuilt.',
    ar: 'تصحيح الرصيد المستحق يحدّث تعرض الصكوك وصافي الثروة. الدفعات المرحّلة تبقى؛ يُعاد بناء الدفعات المستقبلية غير المرحّلة فقط.',
  },
  revalGenericIntro: {
    en: 'revaluation updates net worth only — no cash transaction is created.',
    ar: 'إعادة التقييم تحدّث صافي الثروة فقط — دون إنشاء حركة نقدية.',
  },
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

