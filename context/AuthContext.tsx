
import React, { createContext, useState, ReactNode } from 'react';

interface User {
  name: string;
  email: string;
}

interface AuthContextType {
  isAuthenticated: boolean;
  user: User | null;
  login: (email: string, pass: string) => void;
  logout: () => void;
  signup: (name: string, email: string, pass: string) => void;
}

export const AuthContext = createContext<AuthContextType | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [user, setUser] = useState<User | null>(null);

  const login = (email: string, pass: string) => {
    // In a real app, you'd verify credentials against a backend
    console.log(`Logging in with ${email} and ${pass}`);
    setUser({ name: 'John Doe', email: email });
    setIsAuthenticated(true);
  };

  const logout = () => {
    setIsAuthenticated(false);
    setUser(null);
  };

  const signup = (name: string, email: string, pass: string) => {
    // In a real app, you'd register the user with a backend
    console.log(`Signing up with ${name}, ${email}, and ${pass}`);
    setUser({ name, email });
    setIsAuthenticated(true);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, user, login, logout, signup }}>
      {children}
    </AuthContext.Provider>
  );
};
