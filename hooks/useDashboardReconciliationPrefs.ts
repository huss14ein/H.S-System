import { useState, useEffect } from 'react';

const RECON_PREFS_KEY = 'finova_dashboard_recon_prefs_v1';

export function useDashboardReconciliationPrefs(userId: string | undefined) {
    const [strictReconciliationMode, setStrictReconciliationMode] = useState(true);
    const [hardBlockOnMismatch, setHardBlockOnMismatch] = useState(true);

    useEffect(() => {
        if (!userId) return;
        try {
            const raw = localStorage.getItem(`${RECON_PREFS_KEY}:${userId}`);
            if (!raw) return;
            const parsed = JSON.parse(raw) as { strictReconciliationMode?: boolean; hardBlockOnMismatch?: boolean };
            if (typeof parsed.strictReconciliationMode === 'boolean') setStrictReconciliationMode(parsed.strictReconciliationMode);
            if (typeof parsed.hardBlockOnMismatch === 'boolean') setHardBlockOnMismatch(parsed.hardBlockOnMismatch);
        } catch {
            /* ignore */
        }
    }, [userId]);

    useEffect(() => {
        if (!userId) return;
        try {
            localStorage.setItem(
                `${RECON_PREFS_KEY}:${userId}`,
                JSON.stringify({ strictReconciliationMode, hardBlockOnMismatch }),
            );
        } catch {
            /* ignore */
        }
    }, [userId, strictReconciliationMode, hardBlockOnMismatch]);

    return { strictReconciliationMode, setStrictReconciliationMode, hardBlockOnMismatch, setHardBlockOnMismatch };
}
