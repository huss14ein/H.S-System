import React, { createContext, useContext, ReactNode, useMemo } from 'react';

interface AiContextType {
  isAiAvailable: boolean;
}

export const AiContext = createContext<AiContextType | null>(null);

export const AiProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    
    const isAiAvailable = useMemo(() => {
        // With the geminiService now falling back to the proxy, we can consider AI features
        // to be always available from the client's perspective. The service will handle
        // the actual API key logic.
        return true;
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