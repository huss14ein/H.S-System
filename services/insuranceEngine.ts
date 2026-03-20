/**
 * Insurance and protection planning logic (logic layer).
 *
 * This is a baseline calculator; it does not attempt to model carrier pricing.
 */

export interface CoverageNeed {
  type: 'health' | 'life' | 'disability' | 'property' | 'car' | 'emergency_medical';
  coverageNeeded: number; // total needed
}

export interface CoverageExisting {
  type: CoverageNeed['type'];
  coverageCurrent: number;
  expiryDate?: string; // ISO
}

export function coverageGapCheck(args: {
  needs: CoverageNeed[];
  existing: CoverageExisting[];
}): { gaps: { type: CoverageNeed['type']; gap: number; adequate: boolean }[] } {
  const existingByType = new Map(args.existing.map((e) => [e.type, e.coverageCurrent]));
  const gaps = args.needs.map((n) => {
    const current = existingByType.get(n.type) ?? 0;
    const gap = Math.max(0, n.coverageNeeded - current);
    return { type: n.type, gap, adequate: gap <= 0 };
  });
  return { gaps };
}

export function insuranceRenewalAlert(args: {
  existing: CoverageExisting[];
  asOfDate?: Date;
  /** days before expiry to trigger */
  withinDays?: number;
}): { alerts: { type: CoverageNeed['type']; dueInDays: number }[] } {
  const now = args.asOfDate ?? new Date();
  const withinDays = args.withinDays ?? 30;
  const alerts = args.existing
    .filter((e) => !!e.expiryDate)
    .map((e) => {
      const d = new Date(e.expiryDate as string);
      const diffMs = d.getTime() - now.getTime();
      const dueInDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      return { type: e.type, dueInDays };
    })
    .filter((a) => a.dueInDays >= 0 && a.dueInDays <= withinDays);
  return { alerts };
}

export function emergencyProtectionAdequacy(args: {
  emergencyMedicalNeed: number;
  emergencyMedicalCoverageCurrent: number;
  emergencyFundMonths: number;
  /** If EF is too low, we treat medical protection adequacy more strictly. */
  emergencyFundMinimumMonths?: number;
}): { adequate: boolean; gap: number; label: string } {
  const efMin = args.emergencyFundMinimumMonths ?? 2;
  const need = Math.max(0, Number(args.emergencyMedicalNeed) || 0);
  const current = Math.max(0, Number(args.emergencyMedicalCoverageCurrent) || 0);
  const gap = Math.max(0, need - current);
  const efOk = args.emergencyFundMonths >= efMin;

  // If EF is low, require near-complete coverage.
  if (!efOk) {
    const adequate = gap <= need * 0.05; // <=5% gap
    return { adequate, gap, label: adequate ? 'Adequate with low EF' : 'Gap with low EF' };
  }

  const adequate = gap <= 0;
  return { adequate, gap, label: adequate ? 'Adequate' : 'Under-covered' };
}

