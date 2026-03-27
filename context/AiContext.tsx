import React, { createContext, useContext, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchGeminiProxyHealthStatus } from '../services/aiProxyEndpoints';

interface AiContextType {
    /** True when Netlify AI proxy reports at least one provider key configured. */
    isAiAvailable: boolean;
    /** False until the first health check finishes — avoids flashing “unavailable” while status is unknown. */
    aiHealthChecked: boolean;
    /** Use for disabling AI actions until health has resolved (no “unavailable” flash on load). */
    aiActionsEnabled: boolean;
    /** Re-run proxy health (e.g. after fixing env or network). */
    refreshAiHealth: () => Promise<void>;
}

export const AiContext = createContext<AiContextType | null>(null);

export const AiProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [isAiAvailable, setIsAiAvailable] = useState<boolean>(false);
    const [aiHealthChecked, setAiHealthChecked] = useState<boolean>(false);
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
                setAiHealthChecked(true);
            }
            return;
        }
        try {
            const r = await fetchGeminiProxyHealthStatus(signal);
            if (!mountedRef.current) return;
            setIsAiAvailable(r.configured);
            setAiHealthChecked(true);
        } catch {
            if (!mountedRef.current) return;
            setIsAiAvailable(false);
            setAiHealthChecked(true);
        }
    }, []);

    const refreshAiHealth = useCallback(async () => {
        await runHealthOnce();
    }, [runHealthOnce]);

    useEffect(() => {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 8000);
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
        refreshAiHealth,
    };

    return (
        <AiContext.Provider value={value}>
            {children}
        </AiContext.Provider>
    );
};

export const useAI = () => {
    const context = useContext(AiContext);
    if (!context) {
        throw new Error('useAI must be used within an AiProvider');
    }
    return context;
};
