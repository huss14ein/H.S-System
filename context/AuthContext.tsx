import React, { createContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '../services/supabaseClient';
// FIX: Removed import for User and Session as they are not exported in older versions of supabase-js.
// import type { User, Session } from '@supabase/supabase-js';

interface AuthContextType {
  isAuthenticated: boolean;
  // FIX: Using `any` for user and session types to align with older supabase-js versions and fix type errors.
  user: any | null;
  session: any | null;
  login: (email: string, pass: string) => Promise<any>;
  logout: () => Promise<any>;
  signup: (name: string, email: string, pass: string) => Promise<any>;
}

export const AuthContext = createContext<AuthContextType | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<any | null>(null);
  const [session, setSession] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // FIX: Switched to synchronous session/user retrieval for initial load, compatible with supabase-js v1.
    setSession(supabase.auth.session());
    setUser(supabase.auth.user());
    setLoading(false);

    // FIX: Correctly handle `onAuthStateChange` subscription for v1 API, where the subscription object is in `data`.
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
      }
    );

    return () => {
      authListener?.unsubscribe();
    };
  }, []);


  const login = async (email: string, pass: string) => {
     // FIX: Replaced `signInWithPassword` (v2) with `signIn` (v1).
     const { error } = await supabase.auth.signIn({ email, password: pass });
     if (error) throw error;
  };

  const logout = async () => {
    // NOTE: The `signOut` method is consistent in v1 and v2. The original error was likely due to a broader type inference failure.
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const signup = async (name: string, email: string, pass: string) => {
     // NOTE: The `signUp` method is consistent in v1 and v2.
     const { data, error } = await supabase.auth.signUp({
        email: email,
        password: pass,
        options: {
            data: {
                full_name: name,
            }
        }
     });
     if (error) throw error;
     return data;
  };


  const value = {
    isAuthenticated: !!session,
    user,
    session,
    login,
    logout,
    signup,
  };

  // Render children only when session loading is complete
  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
