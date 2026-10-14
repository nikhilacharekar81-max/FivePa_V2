import React, { createContext, useContext, useState, useEffect } from 'react';
import { UserAccount } from '../types';

interface LoginCredentials {
  email: string;
  password?: string;
}

interface AuthContextType {
  currentUser: UserAccount | null;
  impersonatedUser: UserAccount | null;
  isAuthenticated: boolean;
  isInitializing: boolean;
  setCurrentUser: (user: UserAccount | null | ((prev: UserAccount | null) => UserAccount | null)) => void;
  setImpersonatedUser: (user: UserAccount | null) => void;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, _setCurrentUser] = useState<UserAccount | null>(null);
  const [impersonatedUser, setImpersonatedUser] = useState<UserAccount | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    try {
      const cached = localStorage.getItem('current_user') || localStorage.getItem('user');
      if (cached) {
        _setCurrentUser(JSON.parse(cached));
      }
    } catch (e) {
      console.error("Auth initialization error", e);
    } finally {
      setIsInitializing(false);
    }
  }, []);

  const setCurrentUser = (user: UserAccount | null | ((prev: UserAccount | null) => UserAccount | null)) => {
    _setCurrentUser(prev => {
      const next = typeof user === 'function' ? user(prev) : user;
      if (next) {
        localStorage.setItem('current_user', JSON.stringify(next));
      } else {
        localStorage.removeItem('current_user');
        localStorage.removeItem('user');
      }
      return next;
    });
  };

  const login = async (credentials: LoginCredentials) => {
    // This logic will be migrated from App.tsx in future steps
    console.log("Authenticating...", credentials);
  };

  const logout = async () => {
    setCurrentUser(null);
    setImpersonatedUser(null);
  };

  return (
    <AuthContext.Provider value={{
      currentUser, 
      impersonatedUser, 
      isAuthenticated: !!currentUser, 
      isInitializing,
      setCurrentUser, 
      setImpersonatedUser, 
      login, 
      logout
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
