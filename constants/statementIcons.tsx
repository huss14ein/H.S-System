/**
 * Canonical icons for statement types and upload actions.
 * Use these everywhere (Statement Upload, Statement History, Transactions, Summary)
 * so Bank, SMS, and Trading statements look consistent across the app.
 */
import React from 'react';
import { BanknotesIcon } from '../components/icons/BanknotesIcon';
import { ChatBubbleLeftRightIcon } from '../components/icons/ChatBubbleLeftRightIcon';
import { DocumentArrowUpIcon } from '../components/icons/DocumentArrowUpIcon';

export const StatementIcons = {
  /** Bank statements tab and bank statement uploads */
  bank: BanknotesIcon,
  /** SMS transactions tab and SMS imports */
  sms: ChatBubbleLeftRightIcon,
  /** Trading statements tab and trading statement uploads */
  trading: DocumentArrowUpIcon,
  /** General "Statement Upload" / "Import from statements" action (matches nav) */
  upload: DocumentArrowUpIcon,
} as const;

export type StatementTypeKey = keyof typeof StatementIcons;

/** Resolve icon for a statement from history (bankName or accountType). */
export function getStatementIcon(
  bankName?: string,
  accountType?: string
): React.FC<React.SVGProps<SVGSVGElement>> {
  if (bankName?.toLowerCase().includes('sms')) return StatementIcons.sms;
  if (accountType === 'investment') return StatementIcons.trading;
  return StatementIcons.bank;
}
