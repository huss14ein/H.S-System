import React, { createContext, useContext, ReactNode, useEffect, useState } from 'react';

interface AiContextType {
  isAiAvailable: boolean;
}

export const AiContext = createContext<AiContextType | null>(null);

export const AiProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [isAiAvailable, setIsAiAvailable] = useState<boolean>(false);

    useEffect(() => {
        let cancelled = false;
        const run = async () => {
            if (typeof fetch === 'undefined') return;
            const endpoints = ['/api/gemini-proxy', '/.netlify/functions/gemini-proxy'];
            const controller = new AbortController();
            const timeoutId = window.setTimeout(() => controller.abort(), 2500);
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
                        if (!cancelled) setIsAiAvailable(anyProviderConfigured);
                        return;
                    } catch {
                        // Try next endpoint (e.g. local proxy vs Netlify functions path).
                    }
                }
                if (!cancelled) setIsAiAvailable(false);
            } catch {
                if (!cancelled) setIsAiAvailable(false);
            } finally {
                clearTimeout(timeoutId);
            }
        };
        run();
        return () => {
            cancelled = true;
        };
    }, []);

    const value = {
        isAiAvailable,
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