import React, { createContext, useContext, ReactNode, useMemo } from 'react';

interface AiContextType {
  isAiAvailable: boolean;
}

export const AiContext = createContext<AiContextType | null>(null);

export const AiProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    
    const isAiAvailable = useMemo(() => {
        // In development, AI is available if the client-side key is set.
        if (import.meta.env.DEV) {
            return !!import.meta.env.VITE_GEMINI_API_KEY;
        }
        // In production, we assume the Netlify proxy is configured, so AI is always "available" from the client's perspective.
        // The proxy itself will handle the API key.
        return true;
    }, []);

    if (!isAiAvailable) {
        console.warn('AI features are disabled. For local development, please set VITE_GEMINI_API_KEY in your .env file. See .env.example for more details.');
    }

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