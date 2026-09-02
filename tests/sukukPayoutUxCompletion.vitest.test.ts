/**
 * Sukuk payout UX — end-to-end completion.
 * Path: Command palette / Investments tab → SukukInvestmentsSection →
 * saveSukukPayoutSchedule (DataContext) → sukukPayoutScheduleSave → materializeSukukPayoutEvents →
 * card/next-payout labels via sukukPayoutLabels → Correct outstanding → regenerateSukukFutureSchedule.
 * Exposure on other pages stays on the canonical Sukuk path (see sukukInvestmentSurfacesCompletion).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  SUKUK_PAYOUT_CADENCE_OPTIONS,
  SUKUK_PAYOUT_UX_BANNED_STRINGS,
  formatSukukPayoutCadenceLabel,
  formatSukukPayoutKindLabel,
} from '../services/sukuk/sukukPayoutLabels';
import { materializeSukukPayoutEvents } from '../services/sukuk/sukukPayoutEngine';
import { previewSukukPrincipalRestatement } from '../services/reconciliation/preview';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

function walkTsx(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkTsx(full, acc);
    else if (/\.(tsx|ts)$/.test(name)) acc.push(full);
  }
  return acc;
}

describe('sukukPayoutUxCompletion', () => {
  it('shared labels map domain kinds to everyday language', () => {
    expect(formatSukukPayoutKindLabel('coupon')).toBe('profit');
    expect(formatSukukPayoutKindLabel('principal')).toBe('capital returned');
    expect(formatSukukPayoutCadenceLabel('maturity_only')).toBe('All at maturity');
    expect(formatSukukPayoutCadenceLabel('monthly')).toBe('Every month');
    expect(formatSukukPayoutCadenceLabel('quarterly')).toBe('Every 3 months');
    expect(SUKUK_PAYOUT_CADENCE_OPTIONS).toHaveLength(3);
  });

  it('shared labels include Arabic translations', () => {
    expect(formatSukukPayoutKindLabel('coupon', 'ar')).toBe('ربح');
    expect(formatSukukPayoutKindLabel('principal', 'ar')).toBe('رأس مال مُسترد');
    expect(formatSukukPayoutCadenceLabel('maturity_only', 'ar')).toBe('كامل المبلغ عند الاستحقاق');
    expect(formatSukukPayoutCadenceLabel('monthly', 'ar')).toBe('كل شهر');
    expect(formatSukukPayoutCadenceLabel('quarterly', 'ar')).toBe('كل 3 أشهر');
    for (const option of SUKUK_PAYOUT_CADENCE_OPTIONS) {
      expect(option.title.ar.trim().length).toBeGreaterThan(0);
      expect(option.description.ar.trim().length).toBeGreaterThan(0);
    }
  });

  it('Investments Sukuk section uses shared labels + plain-language CTA path', () => {
    const src = read('components/investments/SukukInvestmentsSection.tsx');
    expect(src).toContain("from '../../services/sukuk/sukukPayoutLabels'");
    expect(src).toContain('SUKUK_PAYOUT_CADENCE_OPTIONS');
    expect(src).toContain('formatSukukPayoutKindLabel');
    expect(src).toContain("t('sukukPayoutHowPaid')");
    expect(src).toContain("t('sukukPayoutSetHowPaid')");
    expect(src).toContain("t('sukukPayoutCorrectOutstanding')");
    expect(src).toContain('useLanguage');
    expect(src).toContain('saveSukukPayoutSchedule');
    expect(src).toContain('applyReconciliationAdjustment');
    expect(src).toContain("mechanism: 'sukuk_face_yield'");
    for (const banned of SUKUK_PAYOUT_UX_BANNED_STRINGS) {
      expect(src, `banned in Sukuk UI: ${banned}`).not.toContain(banned);
    }
  });

  it('LanguageContext ships Arabic copy for the Sukuk payout modal', () => {
    const lang = read('context/LanguageContext.tsx');
    const requiredKeys = [
      'sukukPayoutHowPaid',
      'sukukPayoutIntro',
      'sukukPayoutCashLandsIn',
      'sukukPayoutFrequency',
      'sukukPayoutProfitEach',
      'sukukPayoutCapitalMaturity',
      'sukukPayoutSave',
      'sukukPayoutSetHowPaid',
      'sukukPayoutEditHowPaid',
      'sukukPayoutCorrectOutstanding',
    ];
    for (const key of requiredKeys) {
      expect(lang, `missing DICT key ${key}`).toContain(`${key}:`);
    }
    expect(lang).toContain("ar: 'كيف تُدفع لك؟'");
    expect(lang).toContain("ar: 'حفظ جدول الدفع'");
    expect(lang).toContain("ar: 'حدد كيف تُدفع لك'");
  });

  it('full save → materialize → regenerate path is wired in DataContext + services', () => {
    const ctx = read('context/DataContext.tsx');
    expect(ctx).toContain('saveSukukPayoutSchedule');
    expect(ctx).toContain('regenerateSukukFutureSchedule');
    expect(ctx).toContain('saveSukukPayoutScheduleToDb');
    expect(ctx).toContain('Correct outstanding');
    expect(ctx).toContain('matureSukukDirectPosts');

    const save = read('services/sukuk/sukukPayoutScheduleSave.ts');
    expect(save).toContain('materializeSukukPayoutEvents');
    expect(save).toContain('sukuk_payout_schedules');

    const orch = read('services/reconciliation/orchestrator.ts');
    expect(orch).toContain('applySukukPrincipal');
    expect(orch).toContain('regenerateSukukFutureSchedule');
    expect(orch).toContain('Sukuk outstanding balance corrected');
  });

  it('command palette and Investments page open the Sukuk tab', () => {
    const palette = read('components/CommandPalette.tsx');
    expect(palette).toContain('Go to Investments → Sukuk');
    expect(palette).toContain("investment-tab:Sukuk");

    const inv = read('pages/Investments.tsx');
    expect(inv).toContain("name: 'Sukuk'");
    expect(inv).toContain('SukukInvestmentsSection');
    expect(inv).toContain("investment-tab:");
    expect(inv).toContain("case 'Sukuk':");
  });

  it('reconciliation preview uses plain-language impacts (no coupon/principal jargon)', () => {
    const p = previewSukukPrincipalRestatement({
      positionId: 'sk-1',
      beforeValue: 100000,
      actualValue: 90000,
      faceValue: 100000,
      currency: 'SAR',
      reason: 'Issuer amortization notice',
    });
    expect(p.impacts.join(' ')).toMatch(/outstanding balance/i);
    expect(p.impacts.join(' ')).toMatch(/profit and capital/i);
    expect(p.impacts.join(' ')).not.toMatch(/coupon\/principal/i);
  });

  it('schedule materialize still uses domain kinds (engine contract unchanged)', () => {
    const events = materializeSukukPayoutEvents({
      schedule: {
        id: 's1',
        sukukPositionId: 'pos1',
        investmentAccountId: 'a1',
        currency: 'SAR',
        cadence: 'maturity_only',
        couponAmount: 100,
        principalAmount: null,
        enabled: true,
        startDate: '2025-01-01',
        endDate: '2026-06-01',
      },
      positionDates: { issueDate: '2025-01-01', maturityDate: '2026-06-01' },
      outstandingPrincipal: 10000,
    });
    expect(events.some((e) => e.kind === 'coupon')).toBe(true);
    expect(events.some((e) => e.kind === 'principal')).toBe(true);
    expect(formatSukukPayoutKindLabel(events.find((e) => e.kind === 'coupon')!.kind)).toBe('profit');
  });

  it('no banned payout jargon on user-facing pages/components (except domain comments elsewhere)', () => {
    const roots = ['pages', 'components', 'content'].map((r) => join(ROOT, r));
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of walkTsx(root)) {
        const rel = file.slice(ROOT.length + 1);
        const text = readFileSync(file, 'utf8');
        for (const banned of SUKUK_PAYOUT_UX_BANNED_STRINGS) {
          if (text.includes(banned)) offenders.push(`${rel}: ${banned}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('Assets page has no Sukuk schedule modal; section hint points to Investments', () => {
    expect(read('pages/Assets.tsx')).not.toContain('SukukPayoutScheduleModal');
    expect(read('pages/Assets.tsx')).not.toContain("label: 'Add Sukuk'");
    const hint = read('content/sectionInfoHints.ts');
    expect(hint).toContain('Investments → Sukuk');
    expect(hint).toContain('set how you are paid');
  });

  it('canonical exposure surfaces remain listed (cross-page completeness)', () => {
    const surfaces = [
      'pages/Dashboard.tsx',
      'pages/Summary.tsx',
      'pages/Zakat.tsx',
      'pages/Analysis.tsx',
      'pages/WealthUltraDashboard.tsx',
      'components/analytics/zones/WealthZone.tsx',
      'services/personalNetWorth.ts',
      'services/dashboardKpiSnapshot.ts',
    ];
    for (const path of surfaces) {
      const src = read(path);
      const ok =
        src.includes('sumPersonalSukukPositionsSar') ||
        src.includes('sukukPositionsValueSar') ||
        src.includes('computeHeadlinePersonalInvestmentRoiDecimal') ||
        src.includes('summarizeZakatableSukukPositionsForZakat') ||
        src.includes('pickInvestmentsTotalSar') ||
        src.includes('commodities + Sukuk') ||
        src.includes('platforms + commodities + Sukuk') ||
        src.includes('direct Sukuk');
      expect(ok, `${path} missing Sukuk exposure wiring`).toBe(true);
    }
  });
});
