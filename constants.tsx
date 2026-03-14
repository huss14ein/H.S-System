import React from 'react';
import { Page } from './types';
import { HomeIcon } from './components/icons/HomeIcon';
import { UsersIcon } from './components/icons/UsersIcon';
import { CreditCardIcon } from './components/icons/CreditCardIcon';
import { TrophyIcon } from './components/icons/TrophyIcon';
import { BuildingLibraryIcon } from './components/icons/BuildingLibraryIcon';
import { ReceiptPercentIcon } from './components/icons/ReceiptPercentIcon';
import { ChartBarIcon } from './components/icons/ChartBarIcon';
import { ShieldCheckIcon } from './components/icons/ShieldCheckIcon';
import { AcademicCapIcon } from './components/icons/AcademicCapIcon';
import { PiggyBankIcon } from './components/icons/PiggyBankIcon';
import { BellIcon } from './components/icons/BellIcon';
import { Cog6ToothIcon } from './components/icons/Cog6ToothIcon';
import { PresentationChartLineIcon } from './components/icons/PresentationChartLineIcon';
import { RocketLaunchIcon } from './components/icons/RocketLaunchIcon';
import { SparklesIcon } from './components/icons/SparklesIcon';
import { GiftIcon } from './components/icons/GiftIcon';
import { EyeIcon } from './components/icons/EyeIcon';
import { ChartPieIcon } from './components/icons/ChartPieIcon';
import { HomeModernIcon } from './components/icons/HomeModernIcon';
import { ClipboardDocumentListIcon } from './components/icons/ClipboardDocumentListIcon';

export const NAVIGATION_ITEMS: { name: Page; icon: React.FC<React.SVGProps<SVGSVGElement>> }[] = [
  { name: 'Dashboard', icon: HomeIcon },
  { name: 'Transactions', icon: CreditCardIcon },
  { name: 'Accounts', icon: BuildingLibraryIcon },
  { name: 'Budgets', icon: PiggyBankIcon },
  { name: 'Goals', icon: TrophyIcon },
  { name: 'Zakat', icon: ReceiptPercentIcon },
  { name: 'Analysis', icon: ChartBarIcon },
  { name: 'Forecast', icon: AcademicCapIcon },
  { name: 'Liabilities', icon: ShieldCheckIcon },
  { name: 'Summary', icon: UsersIcon },
  { name: 'Notifications', icon: BellIcon },
  { name: 'Settings', icon: Cog6ToothIcon },
  // Strategy pages
  { name: 'Investment Plan', icon: PresentationChartLineIcon },
  { name: 'Recovery Plan', icon: RocketLaunchIcon },
  { name: 'AI Rebalancer', icon: SparklesIcon },
  { name: 'Dividend Tracker', icon: GiftIcon },
  { name: 'Watchlist', icon: EyeIcon },
  { name: 'Investments', icon: ChartPieIcon },
  { name: 'Assets', icon: HomeModernIcon },
  { name: 'Plan', icon: ClipboardDocumentListIcon },
];
