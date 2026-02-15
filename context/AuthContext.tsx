import React, { createContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '../services/supabaseClient';
// FIX: Supabase types like User, Session, and AuthError are not always exported from the main package in older versions. Importing from '@supabase/gotrue-js' is a more stable alternative.
import type { User, Session, AuthError } from '@supabase/gotrue-js';

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
        if (!supabase) {
            console.warn("Supabase client is not available because environment variables are missing. Authentication is disabled.");
            setLoading(false);
            return;
        }
    
        let mounted = true;
    
        // FIX: Replaced async `getSession()` with sync `session()` for compatibility with older Supabase versions.
        // The initial session is retrieved synchronously, and the auth listener handles any subsequent changes.
        const currentSession = supabase.auth.session();
        if (mounted) {
            setSession(currentSession);
            setUser(currentSession?.user ?? null);
            setLoading(false);
        }
    
        // FIX: Updated `onAuthStateChange` to match the API of older Supabase versions.
        // The listener is retrieved from the `data` property and its `unsubscribe` method is called for cleanup.
        const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
            if (mounted) {
                setSession(session);
                setUser(session?.user ?? null);
            }
        });
    
        return () => {
            mounted = false;
            authListener?.unsubscribe();
        };
    }, []);
    
    const noOpPromise = async (message: string) => {
        console.error(message);
        return { error: { name: 'AuthApiError', message } as AuthError };
    };

    const login = async (email: string, pass: string) => {
        if (!supabase) return noOpPromise('Supabase not configured.');
        // FIX: Replaced `signInWithPassword` with `signIn` for compatibility with older Supabase client versions.
        const { error } = await supabase.auth.signIn({ email, password: pass });
        return { error };
    };
    
    const logout = async () => {
        if (!supabase) return { error: null }; // Logout should not fail
        // FIX: `signOut` is generally consistent, but ensuring it's awaited correctly.
        const { error } = await supabase.auth.signOut();
        return { error };
    };

    const signup = async (name: string, email: string, pass: string) => {
        if (!supabase) return { ...await noOpPromise('Supabase not configured.'), user: null };
        // FIX: Replaced `signUp` with the two-argument version and adjusted response handling for compatibility with older Supabase client versions.
        const { data, error } = await supabase.auth.signUp(
            {
                email,
                password: pass,
            },
            {
                data: {
                    full_name: name,
                }
            }
        );
        return { error, user: data?.user || null };
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