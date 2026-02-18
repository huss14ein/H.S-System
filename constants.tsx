import React from 'react';
import { Page } from './types';
import { HomeIcon } from './components/icons/HomeIcon';
import { UsersIcon } from './components/icons/UsersIcon';
import { ArrowTrendingUpIcon } from './components/icons/ArrowTrendingUpIcon';
import { CreditCardIcon } from './components/icons/CreditCardIcon';
import { TrophyIcon } from './components/icons/TrophyIcon';
import { BuildingLibraryIcon } from './components/icons/BuildingLibraryIcon';
import { ReceiptPercentIcon } from './components/icons/ReceiptPercentIcon';
import { ClipboardDocumentListIcon } from './components/icons/ClipboardDocumentListIcon';
import { ChartBarIcon } from './components/icons/ChartBarIcon';
import { ShieldCheckIcon } from './components/icons/ShieldCheckIcon';
import { ServerStackIcon } from './components/icons/ServerStackIcon';
import { AcademicCapIcon } from './components/icons/AcademicCapIcon';
import { PiggyBankIcon } from './components/icons/PiggyBankIcon';
import { BellIcon } from './components/icons/BellIcon';
import { GoldBarIcon } from './components/icons/GoldBarIcon';
import { Cog6ToothIcon } from './components/icons/Cog6ToothIcon';

export const NAVIGATION_ITEMS: { name: Page; icon: React.FC<React.SVGProps<SVGSVGElement>> }[] = [
  { name: 'Dashboard', icon: HomeIcon },
  { name: 'Transactions', icon: CreditCardIcon },
  { name: 'Accounts', icon: BuildingLibraryIcon },
  { name: 'Investments', icon: ArrowTrendingUpIcon },
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
];