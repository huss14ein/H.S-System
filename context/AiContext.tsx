import React, { createContext, useContext, ReactNode, useEffect, useMemo, useState } from 'react';

interface AiContextType {
    /** True when Netlify AI proxy reports at least one provider key configured. */
    isAiAvailable: boolean;
    /** False until the first health check finishes — avoids flashing “unavailable” while status is unknown. */
    aiHealthChecked: boolean;
    /** Use for disabling AI actions until health has resolved (no “unavailable” flash on load). */
    aiActionsEnabled: boolean;
}

export const AiContext = createContext<AiContextType | null>(null);

export const AiProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [isAiAvailable, setIsAiAvailable] = useState<boolean>(false);
    const [aiHealthChecked, setAiHealthChecked] = useState<boolean>(false);

    useEffect(() => {
        let cancelled = false;
        const run = async () => {
            if (typeof fetch === 'undefined') return;
            const endpoints = ['/api/gemini-proxy', '/.netlify/functions/gemini-proxy'];
            const controller = new AbortController();
            const timeoutId = window.setTimeout(() => controller.abort(), 4500);
            try {
                for (const endpoint of endpoints) {
                    try {
                        const res = await fetch(endpoint, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ health: true }),
                            signal: controller.signal,
                        });
                        if (!res.ok) continue;
                        const json = await res.json();
                        const anyProviderConfigured = Boolean(json?.anyProviderConfigured);
                        if (!cancelled) {
                            setIsAiAvailable(anyProviderConfigured);
                            setAiHealthChecked(true);
                        }
                        return;
                    } catch {
                        // Try next endpoint (e.g. local proxy vs Netlify functions path).
                    }
                }
                if (!cancelled) {
                    setIsAiAvailable(false);
                    setAiHealthChecked(true);
                }
            } catch {
                if (!cancelled) {
                    setIsAiAvailable(false);
                    setAiHealthChecked(true);
                }
            } finally {
                clearTimeout(timeoutId);
            }
        };
        run();
        const onFocus = () => {
            if (!cancelled) run();
        };
        window.addEventListener('focus', onFocus);
        return () => {
            cancelled = true;
            window.removeEventListener('focus', onFocus);
        };
    }, []);

    const aiActionsEnabled = useMemo(() => aiHealthChecked && isAiAvailable, [aiHealthChecked, isAiAvailable]);

    const value = {
        isAiAvailable,
        aiHealthChecked,
        aiActionsEnabled,
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