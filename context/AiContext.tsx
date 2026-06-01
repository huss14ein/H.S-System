import React, { createContext, useContext, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchGeminiProxyHealthStatus } from '../services/aiProxyEndpoints';

export type AiUnavailableReason =
    | 'network'
    | 'no_keys'
    /** Proxy returned 403 (browser Origin not allowlisted on Netlify). */
    | 'origin_blocked'
    /** Got HTML/app shell instead of the function (wrong host or dev server without functions). */
    | 'spa_shell'
    /** /api/gemini-proxy returned 404 — functions not deployed for this site/build. */
    | 'functions_missing'
    | null;

interface AiContextType {
    /** True when Netlify AI proxy reports at least one provider key configured (and health reached the proxy). */
    isAiAvailable: boolean;
    /** False until the first health check finishes — avoids flashing “unavailable” while status is unknown. */
    aiHealthChecked: boolean;
    /** Use for disabling AI actions until health has resolved (no “unavailable” flash on load). */
    aiActionsEnabled: boolean;
    /** Why AI is off after a successful check: unreachable proxy vs reachable but no API keys. */
    aiUnavailableReason: AiUnavailableReason;
    /** Re-run proxy health (e.g. after fixing env or network). */
    refreshAiHealth: () => Promise<void>;
}

export const AiContext = createContext<AiContextType | null>(null);

export const AiProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [isAiAvailable, setIsAiAvailable] = useState<boolean>(false);
    const [aiHealthChecked, setAiHealthChecked] = useState<boolean>(false);
    const [aiUnavailableReason, setAiUnavailableReason] = useState<AiUnavailableReason>(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const runHealthOnce = useCallback(async (signal?: AbortSignal) => {
        if (typeof fetch === 'undefined') {
            if (mountedRef.current) {
                setIsAiAvailable(false);
                setAiUnavailableReason('network');
                setAiHealthChecked(true);
            }
            return;
        }
        try {
            const r = await fetchGeminiProxyHealthStatus(signal);
            if (!mountedRef.current) return;
            const available = r.reachable && r.configured;
            setIsAiAvailable(available);
            if (!r.reachable) {
                if (r.unreachableReason === 'origin_forbidden') {
                    setAiUnavailableReason('origin_blocked');
                } else if (r.unreachableReason === 'spa_shell') {
                    setAiUnavailableReason('spa_shell');
                } else if (r.unreachableReason === 'functions_missing') {
                    setAiUnavailableReason('functions_missing');
                } else {
                    setAiUnavailableReason('network');
                }
            } else if (!r.configured) {
                setAiUnavailableReason('no_keys');
            } else {
                setAiUnavailableReason(null);
            }
            setAiHealthChecked(true);
        } catch {
            if (!mountedRef.current) return;
            setIsAiAvailable(false);
            setAiUnavailableReason('network');
            setAiHealthChecked(true);
        }
    }, []);

    const refreshAiHealth = useCallback(async () => {
        await runHealthOnce();
    }, [runHealthOnce]);

    useEffect(() => {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 15000);
        void runHealthOnce(controller.signal).finally(() => {
            clearTimeout(timeoutId);
        });
        const onFocus = () => {
            void runHealthOnce();
        };
        window.addEventListener('focus', onFocus);
        return () => {
            controller.abort();
            clearTimeout(timeoutId);
            window.removeEventListener('focus', onFocus);
        };
    }, [runHealthOnce]);

    const aiActionsEnabled = useMemo(() => aiHealthChecked && isAiAvailable, [aiHealthChecked, isAiAvailable]);

    const value = {
        isAiAvailable,
        aiHealthChecked,
        aiActionsEnabled,
        aiUnavailableReason,
        refreshAiHealth,
    };

    return <AiContext.Provider value={value}>{children}</AiContext.Provider>;
};

export const useAI = () => {
    const context = useContext(AiContext);
    if (!context) {
        throw new Error('useAI must be used within an AiProvider');
    }
    return context;
};
