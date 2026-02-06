import React, { createContext, useState, useEffect, ReactNode } from 'react';
import { supabase, isSupabaseConfigured } from '../services/supabaseClient';
import type { User, Session } from '@supabase/supabase-js';

interface AuthContextType {
  isAuthenticated: boolean;
  user: User | null;
  session: Session | null;
  login: (email: string, pass: string) => Promise<any>;
  logout: () => Promise<any>;
  signup: (name: string, email: string, pass: string) => Promise<any>;
}

export const AuthContext = createContext<AuthContextType | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const getInitialSession = async () => {
      // If Supabase isn't configured, don't attempt to fetch a session.
      // This prevents network errors and ensures the login page is shown.
      if (!isSupabaseConfigured) {
        setSession(null);
        setUser(null);
        setLoading(false);
        return;
      }

      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) {
            console.error("Error fetching auth session:", error.message);
            setSession(null);
            setUser(null);
        } else {
            setSession(session);
            setUser(session?.user ?? null);
        }
      } catch (e) {
        console.error("A critical error occurred while initializing authentication:", e);
        setSession(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    getInitialSession();

    if (isSupabaseConfigured) {
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
          setSession(session);
          setUser(session?.user ?? null);
        });

        return () => {
          subscription?.unsubscribe();
        };
    }
  }, []);


  const login = async (email: string, pass: string) => {
     if (!isSupabaseConfigured) {
        throw new Error("Application is not configured to connect to the authentication server.");
     }
     const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
     if (error) throw error;
  };

  const logout = async () => {
    if (!isSupabaseConfigured) return; // Fail silently on logout if not configured
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const signup = async (name: string, email: string, pass: string) => {
     if (!isSupabaseConfigured) {
        throw new Error("Application is not configured to connect to the authentication server.");
     }
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