import React, { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { api } from '@services/api';
import type { ApiResponse } from '@services/api';

interface User {
  id: string;
  name: string;
  email: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = async () => {
    try {
      const response = await api.get<ApiResponse<User>>('/auth/me');
      if (response.data.success && response.data.data) {
        setUser(response.data.data);
        localStorage.setItem('user', JSON.stringify(response.data.data));
      }
    } catch {
      setUser(null);
      localStorage.removeItem('user');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    const accessToken = localStorage.getItem('accessToken');

    if (storedUser && accessToken) {
      try {
        setUser(JSON.parse(storedUser));
      } catch {
        localStorage.removeItem('user');
      }
    }
    setIsLoading(false);
  }, []);

  const login = async (email: string, password: string) => {
    const response = await api.post<ApiResponse<{
      user: User;
      tokens: { accessToken: string; refreshToken: string; refreshTokenFamily: string; expiresIn: number };
    }>>('/auth/login', { email, password });

    if (response.data.success && response.data.data) {
      const { user, tokens } = response.data.data;
      localStorage.setItem('accessToken', tokens.accessToken);
      localStorage.setItem('refreshToken', tokens.refreshToken);
      localStorage.setItem('tokenFamily', tokens.refreshTokenFamily);
      localStorage.setItem('user', JSON.stringify(user));
      setUser(user);
    }
  };

  const register = async (name: string, email: string, password: string) => {
    const response = await api.post<ApiResponse<{
      user: User;
      tokens: { accessToken: string; refreshToken: string; refreshTokenFamily: string; expiresIn: number };
    }>>('/auth/register', { name, email, password });

    if (response.data.success && response.data.data) {
      const { user, tokens } = response.data.data;
      localStorage.setItem('accessToken', tokens.accessToken);
      localStorage.setItem('refreshToken', tokens.refreshToken);
      localStorage.setItem('tokenFamily', tokens.refreshTokenFamily);
      localStorage.setItem('user', JSON.stringify(user));
      setUser(user);
    }
  };

  const logout = async () => {
    const tokenFamily = localStorage.getItem('tokenFamily');
    if (tokenFamily) {
      try {
        await api.post('/auth/logout', { tokenFamily });
      } catch {
        // Ignore logout errors
      }
    }
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('tokenFamily');
    localStorage.removeItem('user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};