import React from 'react';
import { Page } from './types';
import { HomeIcon } from './components/icons/HomeIcon';
import { UsersIcon } from './components/icons/UsersIcon';
import { ArrowTrendingUpIcon } from './components/icons/ArrowTrendingUpIcon';
import { CreditCardIcon } from './components/icons/CreditCardIcon';
import { TrophyIcon } from './components/icons/TrophyIcon';
import { BuildingLibraryIcon } from './components/icons/BuildingLibraryIcon';
import { ClipboardDocumentListIcon } from './components/icons/ClipboardDocumentListIcon';
import { ChartBarIcon } from './components/icons/ChartBarIcon';
import { ShieldCheckIcon } from './components/icons/ShieldCheckIcon';
import { ServerStackIcon } from './components/icons/ServerStackIcon';
import { AcademicCapIcon } from './components/icons/AcademicCapIcon';
import { PiggyBankIcon } from './components/icons/PiggyBankIcon';
import { BellIcon } from './components/icons/BellIcon';
import { GoldBarIcon } from './components/icons/GoldBarIcon';
import { Cog6ToothIcon } from './components/icons/Cog6ToothIcon';
import { PresentationChartLineIcon } from './components/icons/PresentationChartLineIcon';
import { DocumentArrowUpIcon } from './components/icons/DocumentArrowUpIcon';
import { DocumentTextIcon } from './components/icons/DocumentTextIcon';
import { CubeIcon } from './components/icons/CubeIcon';
import { FlagIcon } from './components/icons/FlagIcon';
import { BanknotesIcon } from './components/icons/BanknotesIcon';
import { SparklesIcon } from './components/icons/SparklesIcon';
import { EyeIcon } from './components/icons/EyeIcon';
import { ReceiptPercentIcon } from './components/icons/ReceiptPercentIcon';

/** User-friendly display names for pages (nav, command palette, document title) */
export const PAGE_DISPLAY_NAMES: Partial<Record<Page, string>> = {
  'Engines & Tools': 'Money Tools',
  Notifications: 'Tasks & alerts',
};

/** Sub-views opened only inside Investments (not top-level nav / hash routes). */
export const INVESTMENT_SUB_NAV_ITEMS: { name: Page; icon: React.FC<React.SVGProps<SVGSVGElement>> }[] = [
  { name: 'Recovery Plan', icon: FlagIcon },
  { name: 'Investment Plan', icon: ClipboardDocumentListIcon },
  { name: 'Dividend Tracker', icon: BanknotesIcon },
  { name: 'AI Rebalancer', icon: SparklesIcon },
  { name: 'Watchlist', icon: EyeIcon },
];

export const INVESTMENT_SUB_NAV_PAGE_NAMES: readonly Page[] = INVESTMENT_SUB_NAV_ITEMS.map((i) => i.name);

export const NAVIGATION_ITEMS: { name: Page; icon: React.FC<React.SVGProps<SVGSVGElement>> }[] = [
  { name: 'Dashboard', icon: HomeIcon },
  { name: 'Wealth Ultra', icon: PresentationChartLineIcon },
  { name: 'Transactions', icon: CreditCardIcon },
  { name: 'Installments', icon: ReceiptPercentIcon },
  { name: 'Statement Upload', icon: DocumentArrowUpIcon },
  { name: 'Statement History', icon: DocumentTextIcon },
  { name: 'Accounts', icon: BuildingLibraryIcon },
  { name: 'Investments', icon: ArrowTrendingUpIcon },
  { name: 'Market Events', icon: ChartBarIcon },
  { name: 'Budgets', icon: PiggyBankIcon },
  { name: 'Goals', icon: TrophyIcon },
  { name: 'Zakat', icon: ReceiptPercentIcon },
  { name: 'Plan', icon: ClipboardDocumentListIcon },
  { name: 'Summary', icon: UsersIcon },
  { name: 'Assets', icon: GoldBarIcon },
  { name: 'Liabilities', icon: ShieldCheckIcon },
  { name: 'Forecast', icon: AcademicCapIcon },
  { name: 'Analysis', icon: ChartBarIcon },
  { name: 'System & APIs Health', icon: ServerStackIcon },
  { name: 'Notifications', icon: BellIcon },
  { name: 'Settings', icon: Cog6ToothIcon },
  { name: 'Engines & Tools', icon: CubeIcon },
];

/** All pages linkable from a task (top nav + Investments sub-tabs). */
export const ALL_TODO_LINK_PAGES: Page[] = Array.from(
  new Set<Page>([...NAVIGATION_ITEMS.map((i) => i.name), ...INVESTMENT_SUB_NAV_ITEMS.map((i) => i.name)]),
).sort((a, b) => a.localeCompare(b));
