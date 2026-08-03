import { useContext, useEffect, useState } from 'react';
import { AuthContext } from '../context/AuthContext';
import { supabase } from '../services/supabaseClient';
import type { UserRole } from '../types';

/**
 * Role + permitted/shared category lists for budgetCardCategoryNames —
 * same sources as Transactions Map-to and Budgets cards.
 */
export function useBudgetCardMappingGovernance(): {
  userRole: UserRole;
  permittedCategories: string[];
  sharedCategories: string[];
} {
  const auth = useContext(AuthContext);
  const userRole: UserRole = auth?.isAdmin ? 'Admin' : 'Restricted';
  const [permittedCategories, setPermittedCategories] = useState<string[]>([]);
  const [sharedCategories, setSharedCategories] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!supabase || !auth?.user || userRole === 'Admin') {
        if (!cancelled) {
          setPermittedCategories([]);
          setSharedCategories([]);
        }
        return;
      }

      const { data: permissions } = await supabase
        .from('permissions')
        .select('category_id, categories(name)')
        .eq('user_id', auth.user.id);

      const allowed = (permissions || []).map((p: any) => p.categories?.name).filter(Boolean);
      if (cancelled) return;
      setPermittedCategories(allowed);

      const { data: sharedRows } = await supabase
        .rpc('get_shared_budgets_for_me')
        .then((r) => r, () => ({ data: [] as any[] } as any));
      const sharedCats = Array.from(
        new Set(
          ((sharedRows || []) as any[])
            .map((row) => String(row?.category || '').trim())
            .filter(Boolean),
        ),
      );
      if (cancelled) return;
      setSharedCategories(sharedCats);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [auth?.user?.id, auth?.isAdmin, userRole]);

  return { userRole, permittedCategories, sharedCategories };
}
