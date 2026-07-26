/**
 * Lightweight hydration for optional "foundations" tables (added incrementally):
 * period_locks, household_members, member_allocations, vault_documents,
 * subscriptions, pension_accounts, estate_beneficiaries.
 *
 * Each select is optional (missing table → empty) so the app never breaks before a
 * migration is applied. Kept out of the main tiered hydrate to avoid touching that
 * index-parallel machinery.
 */
import type {
  EstateBeneficiary,
  FinancialData,
  HouseholdMember,
  HouseholdMemberRole,
  MemberAllocation,
  MemberAllocationKind,
  PensionAccount,
  SubscriptionRecord,
  VaultDocument,
} from '../types';
import { normalizePeriodLockRow } from './periodLocks';

type Db = { from: (table: string) => any };

async function trySelectAll(db: Db, table: string, userId: string): Promise<any[]> {
  try {
    const { data, error } = await db.from(table).select('*').eq('user_id', userId);
    if (error) return [];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function normalizeHouseholdMember(row: any): HouseholdMember {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    role: (String(row.role ?? 'dependent') as HouseholdMemberRole),
    owner: row.owner ?? undefined,
    notes: row.notes ?? undefined,
  };
}

function normalizeMemberAllocation(row: any): MemberAllocation {
  return {
    id: String(row.id ?? ''),
    memberId: String(row.member_id ?? row.memberId ?? ''),
    kind: (String(row.kind ?? 'allowance') as MemberAllocationKind),
    categoryId: String(row.category_id ?? row.categoryId ?? 'allowance'),
    label: String(row.label ?? ''),
    monthlyAmount: Number(row.monthly_amount ?? row.monthlyAmount ?? 0) || 0,
    scheduleMonths: Array.isArray(row.schedule_months ?? row.scheduleMonths)
      ? (row.schedule_months ?? row.scheduleMonths).map((n: unknown) => Number(n)).filter(Number.isFinite)
      : undefined,
    enabled: row.enabled !== false,
  };
}

function normalizeVaultDocument(row: any): VaultDocument {
  return {
    id: String(row.id ?? ''),
    title: String(row.title ?? ''),
    kind: (String(row.kind ?? 'other') as VaultDocument['kind']),
    linkedEntityType: (row.linked_entity_type ?? row.linkedEntityType ?? null) as VaultDocument['linkedEntityType'],
    linkedEntityId: (row.linked_entity_id ?? row.linkedEntityId ?? null) as string | null,
    notes: row.notes ?? undefined,
    createdAt: row.created_at ?? row.createdAt ?? undefined,
  };
}

function normalizeSubscription(row: any): SubscriptionRecord {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    amount: Number(row.amount ?? 0) || 0,
    currency: (String(row.currency ?? 'SAR') as 'SAR' | 'USD'),
    cadence: (String(row.cadence ?? 'monthly') as SubscriptionRecord['cadence']),
    nextRenewalDate: row.next_renewal_date ?? row.nextRenewalDate ?? undefined,
    status: (String(row.status ?? 'active') as SubscriptionRecord['status']),
    priceHistory: Array.isArray(row.price_history ?? row.priceHistory) ? (row.price_history ?? row.priceHistory) : undefined,
    accountId: row.account_id ?? row.accountId ?? undefined,
    categoryId: row.category_id ?? row.categoryId ?? undefined,
    notes: row.notes ?? undefined,
  };
}

function normalizePensionAccount(row: any): PensionAccount {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    kind: (String(row.kind ?? 'gosi') as PensionAccount['kind']),
    balance: Number(row.balance ?? 0) || 0,
    currency: (String(row.currency ?? 'SAR') as 'SAR' | 'USD'),
    employeeContributionMonthly:
      (row.employee_contribution_monthly ?? row.employeeContributionMonthly) != null
        ? Number(row.employee_contribution_monthly ?? row.employeeContributionMonthly) || 0
        : undefined,
    employerContributionMonthly:
      (row.employer_contribution_monthly ?? row.employerContributionMonthly) != null
        ? Number(row.employer_contribution_monthly ?? row.employerContributionMonthly) || 0
        : undefined,
    owner: row.owner ?? undefined,
  };
}

function normalizeEstateBeneficiary(row: any): EstateBeneficiary {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    relationship: row.relationship ?? undefined,
    sharePercent:
      (row.share_percent ?? row.sharePercent) != null
        ? Number(row.share_percent ?? row.sharePercent) || 0
        : undefined,
    notes: row.notes ?? undefined,
  };
}

export type FoundationsHydrateResult = Pick<
  FinancialData,
  | 'periodLocks'
  | 'householdMembers'
  | 'memberAllocations'
  | 'vaultDocuments'
  | 'subscriptions'
  | 'pensionAccounts'
  | 'estateBeneficiaries'
>;

export async function hydrateFoundationsTables(db: Db, userId: string): Promise<FoundationsHydrateResult> {
  const [
    periodLockRows,
    memberRows,
    allocationRows,
    documentRows,
    subscriptionRows,
    pensionRows,
    beneficiaryRows,
  ] = await Promise.all([
    trySelectAll(db, 'period_locks', userId),
    trySelectAll(db, 'household_members', userId),
    trySelectAll(db, 'member_allocations', userId),
    trySelectAll(db, 'vault_documents', userId),
    trySelectAll(db, 'subscriptions', userId),
    trySelectAll(db, 'pension_accounts', userId),
    trySelectAll(db, 'estate_beneficiaries', userId),
  ]);

  return {
    periodLocks: periodLockRows.map((r) => normalizePeriodLockRow(r as Record<string, unknown>)),
    householdMembers: memberRows.map(normalizeHouseholdMember),
    memberAllocations: allocationRows.map(normalizeMemberAllocation),
    vaultDocuments: documentRows.map(normalizeVaultDocument),
    subscriptions: subscriptionRows.map(normalizeSubscription),
    pensionAccounts: pensionRows.map(normalizePensionAccount),
    estateBeneficiaries: beneficiaryRows.map(normalizeEstateBeneficiary),
  };
}
