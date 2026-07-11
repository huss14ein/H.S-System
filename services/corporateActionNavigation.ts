import type { Page } from '../types';
import type { CorporateActionType } from './corporateActions';

export const CORPORATE_ACTION_WIZARD_STORAGE_KEY = 'finova_corporate_action_wizard_v1';

export type CorporateActionWizardPlan = {
  portfolioId: string;
  symbol: string;
  actionType?: CorporateActionType;
};

/** Deep-link to Investments → Corporate action wizard with optional pre-fill. */
export function stashCorporateActionWizardPlan(args: CorporateActionWizardPlan): void {
  try {
    sessionStorage.setItem(
      CORPORATE_ACTION_WIZARD_STORAGE_KEY,
      JSON.stringify({
        portfolioId: args.portfolioId,
        symbol: args.symbol.trim().toUpperCase(),
        ...(args.actionType ? { actionType: args.actionType } : {}),
      }),
    );
  } catch {
    /* private mode */
  }
}

export function readCorporateActionWizardPlan(): CorporateActionWizardPlan | null {
  try {
    const raw = sessionStorage.getItem(CORPORATE_ACTION_WIZARD_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CorporateActionWizardPlan;
    if (!parsed?.portfolioId?.trim() || !parsed?.symbol?.trim()) return null;
    return {
      portfolioId: parsed.portfolioId.trim(),
      symbol: parsed.symbol.trim().toUpperCase(),
      actionType: parsed.actionType,
    };
  } catch {
    return null;
  }
}

export function clearCorporateActionWizardPlan(): void {
  try {
    sessionStorage.removeItem(CORPORATE_ACTION_WIZARD_STORAGE_KEY);
  } catch {
    /* private mode */
  }
}

export function openCorporateActionWizard(args: {
  portfolioId?: string;
  symbol?: string;
  actionType?: CorporateActionType;
  setActivePage?: (page: Page) => void;
  triggerPageAction?: (page: Page, action: string) => void;
}): void {
  const canPrefill = Boolean(args.portfolioId?.trim()) && Boolean(args.symbol?.trim());

  if (canPrefill) {
    stashCorporateActionWizardPlan({
      portfolioId: args.portfolioId!.trim(),
      symbol: args.symbol!.trim(),
      actionType: args.actionType,
    });
    if (args.triggerPageAction) {
      args.triggerPageAction('Investments', 'open-corporate-action-wizard:from-plan');
      return;
    }
    args.setActivePage?.('Investments');
    return;
  }

  if (args.triggerPageAction) {
    args.triggerPageAction('Investments', 'open-corporate-action-wizard');
    return;
  }
  args.setActivePage?.('Investments');
}
