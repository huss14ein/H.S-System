import React, { useMemo, useState } from 'react';
import { useData } from '../../context/DataContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { supabase } from '../../services/supabaseClient';
import { isRestrictedRole } from '../../utils/role';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { buildMemberAllocationRows, sumMemberAllocationsMonthly } from '../../services/householdBudgetEngine';
import type { HouseholdMember, MemberAllocation, MemberAllocationKind, HouseholdMemberRole } from '../../types';

const MEMBER_ROLES: HouseholdMemberRole[] = ['self', 'spouse', 'dependent'];
const ALLOCATION_KINDS: { value: MemberAllocationKind; label: string }[] = [
  { value: 'allowance', label: 'Allowance' },
  { value: 'education_public', label: 'Education (public)' },
  { value: 'education_private', label: 'Education (private)' },
  { value: 'other', label: 'Other' },
];

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `hm-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

/**
 * Minimal household members + per-member monthly allocations panel.
 * Persists directly to optional Supabase tables (`household_members`, `member_allocations`)
 * and mirrors into local state via `applyFinancialDataPatch`. Degrades gracefully offline.
 */
const HouseholdMembersPanel: React.FC = () => {
  const { data, applyFinancialDataPatch } = useData();
  const auth = useAuth();
  const { showToast: toast } = useToast();
  const { formatCurrencyString } = useFormatCurrency();
  const canMutate = !isRestrictedRole(auth?.userRole);

  const members = data?.householdMembers ?? [];
  const allocations = data?.memberAllocations ?? [];
  const month = new Date().getMonth() + 1;
  const rows = useMemo(() => buildMemberAllocationRows(members, allocations, month), [members, allocations, month]);
  const monthlyTotal = useMemo(() => sumMemberAllocationsMonthly(members, allocations, month), [members, allocations, month]);

  const [memberName, setMemberName] = useState('');
  const [memberRole, setMemberRole] = useState<HouseholdMemberRole>('self');
  const [allocMemberId, setAllocMemberId] = useState('');
  const [allocKind, setAllocKind] = useState<MemberAllocationKind>('allowance');
  const [allocLabel, setAllocLabel] = useState('');
  const [allocAmount, setAllocAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const addMember = async () => {
    if (!canMutate || !memberName.trim()) return;
    const userId = auth?.user?.id;
    const member: HouseholdMember = {
      id: newId(),
      name: memberName.trim(),
      role: memberRole,
    };
    setBusy(true);
    try {
      if (supabase && userId) {
        const { error } = await supabase.from('household_members').insert({
          id: member.id,
          user_id: userId,
          name: member.name,
          role: member.role,
        });
        if (error && error.code !== 'PGRST205') {
          toast(`Could not save member: ${error.message}`, 'error');
          return;
        }
      }
      applyFinancialDataPatch((prev) => ({
        ...prev,
        householdMembers: [...(prev.householdMembers ?? []), member],
      }));
      setMemberName('');
      toast('Member added', 'success');
    } finally {
      setBusy(false);
    }
  };

  const addAllocation = async () => {
    if (!canMutate || !allocMemberId) return toast('Pick a member', 'error');
    const amount = Math.max(0, parseFloat(allocAmount) || 0);
    if (!(amount > 0)) return toast('Enter a positive monthly amount', 'error');
    const userId = auth?.user?.id;
    const allocation: MemberAllocation = {
      id: newId(),
      memberId: allocMemberId,
      kind: allocKind,
      categoryId: allocKind,
      label: allocLabel.trim() || ALLOCATION_KINDS.find((k) => k.value === allocKind)!.label,
      monthlyAmount: amount,
      enabled: true,
    };
    setBusy(true);
    try {
      if (supabase && userId) {
        const { error } = await supabase.from('member_allocations').insert({
          id: allocation.id,
          user_id: userId,
          member_id: allocation.memberId,
          kind: allocation.kind,
          category_id: allocation.categoryId,
          label: allocation.label,
          monthly_amount: allocation.monthlyAmount,
          enabled: true,
        });
        if (error && error.code !== 'PGRST205') {
          toast(`Could not save allocation: ${error.message}`, 'error');
          return;
        }
      }
      applyFinancialDataPatch((prev) => ({
        ...prev,
        memberAllocations: [...(prev.memberAllocations ?? []), allocation],
      }));
      setAllocLabel('');
      setAllocAmount('');
      toast('Allocation added', 'success');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-dark">Household Members</h3>
          <p className="text-sm text-gray-500">Per-member allowances and education envelopes for this month.</p>
        </div>
        <div className="text-sm text-gray-500">
          Monthly total <span className="font-semibold text-dark">{formatCurrencyString(monthlyTotal, { digits: 0 })}</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="p-2">Member</th>
              <th className="p-2">Role</th>
              <th className="p-2">Allocation</th>
              <th className="p-2 text-right">Monthly</th>
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? rows.map((r) => (
              <tr key={r.allocationId} className="border-t">
                <td className="p-2 font-medium">{r.memberName}</td>
                <td className="p-2 text-slate-500">{r.memberRole}</td>
                <td className="p-2">{r.label}</td>
                <td className="p-2 text-right">{formatCurrencyString(r.monthlyAmount, { digits: 0 })}</td>
              </tr>
            )) : (
              <tr>
                <td className="p-3 text-slate-500" colSpan={4}>
                  No member allocations yet. Add a member and an allowance below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canMutate && (
        <div className="grid gap-4 md:grid-cols-2 border-t border-gray-100 pt-4">
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-dark">Add member</h4>
            <input
              className="w-full border rounded px-2 py-1.5 text-sm"
              placeholder="Name"
              value={memberName}
              onChange={(e) => setMemberName(e.target.value)}
            />
            <select className="w-full border rounded px-2 py-1.5 text-sm" value={memberRole} onChange={(e) => setMemberRole(e.target.value as HouseholdMemberRole)}>
              {MEMBER_ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <button type="button" disabled={busy} className="btn-primary w-full disabled:opacity-50" onClick={addMember}>
              Add member
            </button>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-dark">Add allocation</h4>
            <select className="w-full border rounded px-2 py-1.5 text-sm" value={allocMemberId} onChange={(e) => setAllocMemberId(e.target.value)}>
              <option value="">Select member…</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            <select className="w-full border rounded px-2 py-1.5 text-sm" value={allocKind} onChange={(e) => setAllocKind(e.target.value as MemberAllocationKind)}>
              {ALLOCATION_KINDS.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
            <input
              className="w-full border rounded px-2 py-1.5 text-sm"
              placeholder="Label (optional)"
              value={allocLabel}
              onChange={(e) => setAllocLabel(e.target.value)}
            />
            <input
              type="number"
              min="0"
              className="w-full border rounded px-2 py-1.5 text-sm"
              placeholder="Monthly amount (SAR)"
              value={allocAmount}
              onChange={(e) => setAllocAmount(e.target.value)}
            />
            <button type="button" disabled={busy} className="btn-primary w-full disabled:opacity-50" onClick={addAllocation}>
              Add allocation
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default HouseholdMembersPanel;
