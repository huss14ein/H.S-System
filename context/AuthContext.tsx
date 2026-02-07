import React, { createContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '../services/supabaseClient';
import type { User, Session, AuthError } from '@supabase/supabase-js';

interface AuthContextType {
  isAuthenticated: boolean;
  user: User | null;
  session: Session | null;
  login: (email: string, pass: string) => Promise<{ error: AuthError | null }>;
  logout: () => Promise<{ error: AuthError | null }>;
  signup: (name: string, email: string, pass: string) => Promise<{ error: AuthError | null; user: User | null }>;
}

export const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);

        if (!supabase) {
            console.warn("Supabase client is not available because environment variables are missing. Authentication is disabled.");
            setLoading(false);
            return;
        }
        
        const fetchSession = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            setSession(session);
            setUser(session?.user ?? null);
            setLoading(false);
        };
        fetchSession();

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
            setUser(session?.user ?? null);
        });

        return () => {
            subscription?.unsubscribe();
        };
    }, []);
    
    const noOpPromise = async (message: string) => {
        console.error(message);
        return { error: { name: 'AuthApiError', message } as AuthError };
    };

    const login = async (email: string, pass: string) => {
        if (!supabase) return noOpPromise('Supabase not configured.');
        const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
        return { error };
    };
    
    const logout = async () => {
        if (!supabase) return { error: null }; // Logout should not fail
        const { error } = await supabase.auth.signOut();
        return { error };
    };

    const signup = async (name: string, email: string, pass: string) => {
        if (!supabase) return { ...await noOpPromise('Supabase not configured.'), user: null };
        const { data, error } = await supabase.auth.signUp({
            email,
            password: pass,
            options: {
                data: {
                    full_name: name,
                }
            }
        });
        return { error, user: data.user };
    };

    const value = {
        isAuthenticated: !!user,
        user,
        session,
        login,
        logout,
        signup
    };
    
    if (loading) {
        return <div className="flex justify-center items-center h-screen bg-light"><div>Loading Authentication...</div></div>;
    }

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};
