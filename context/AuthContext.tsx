import React, { createContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '../services/supabaseClient';
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

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, []);


  const login = async (email: string, pass: string) => {
     const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
     if (error) throw error;
  };

  const logout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const signup = async (name: string, email: string, pass: string) => {
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