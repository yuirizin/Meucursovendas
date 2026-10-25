import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, AuthResponse } from '../types/index.js';
import { clientStorage } from '../services/clientStorage';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'zeus_auth_token';
const USER_KEY = 'zeus_current_user';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const stored = localStorage.getItem(USER_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const [token, setToken] = useState<string | null>(localStorage.getItem(TOKEN_KEY));
  const [loading, setLoading] = useState(true);

  // Check current session on mount
  useEffect(() => {
    const verifySession = async () => {
      const storedToken = localStorage.getItem(TOKEN_KEY);
      const storedUser = localStorage.getItem(USER_KEY);

      if (!storedToken || !storedUser) {
        setLoading(false);
        return;
      }

      try {
        // Try verifying with backend if available
        const res = await fetch('/api/auth/me', {
          headers: {
            Authorization: `Bearer ${storedToken}`
          }
        });

        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.includes('application/json')) {
          const data = await res.json();
          setUser(data.user);
          setToken(storedToken);
          localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        } else {
          // If running on static host (like Netlify) without Express backend, restore from storedUser
          const parsedUser = JSON.parse(storedUser);
          setUser(parsedUser);
          setToken(storedToken);
        }
      } catch (err) {
        // On offline or static host (Netlify), maintain session
        try {
          const parsedUser = JSON.parse(storedUser);
          setUser(parsedUser);
          setToken(storedToken);
        } catch {
          setUser(null);
          setToken(null);
        }
      } finally {
        setLoading(false);
      }
    };

    verifySession();
  }, []);

  const login = async (usernameInput: string, passwordInput: string) => {
    const cleanUser = usernameInput.trim();
    const cleanPass = passwordInput.trim();

    if (!cleanUser || !cleanPass) {
      return { success: false, error: 'Por favor, digite seu usuário e senha.' };
    }

    try {
      // 1. Try server backend authentication
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: cleanUser, password: cleanPass })
      });

      const contentType = res.headers.get('content-type') || '';

      // If server responded with JSON (Express backend active)
      if (contentType.includes('application/json')) {
        const data = await res.json();
        if (res.ok && data.success) {
          const authData = data as AuthResponse;
          setUser(authData.user);
          setToken(authData.token);
          localStorage.setItem(TOKEN_KEY, authData.token);
          localStorage.setItem(USER_KEY, JSON.stringify(authData.user));
          return { success: true };
        } else {
          // Check if error was invalid credentials or user not found
          return { success: false, error: data.error || 'Credenciais inválidas.' };
        }
      }
    } catch {
      // Server not reachable (e.g. Netlify static hosting) -> fall through to client storage
    }

    // 2. Client-side authentication fallback (Guarantees 100% operation on Netlify & static hosts)
    const clientResult = clientStorage.authenticate(cleanUser, cleanPass);
    if (clientResult.success && clientResult.user && clientResult.token) {
      setUser(clientResult.user);
      setToken(clientResult.token);
      localStorage.setItem(TOKEN_KEY, clientResult.token);
      localStorage.setItem(USER_KEY, JSON.stringify(clientResult.user));
      return { success: true };
    }

    return {
      success: false,
      error: clientResult.error || 'Usuário ou senha incorretos. Verifique suas credenciais.'
    };
  };

  const logout = async () => {
    if (token) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        });
      } catch {
        // Ignore network errors on static hosts
      }
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
    setToken(null);
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    if (!token || !user) return { success: false, error: 'Sessão inválida.' };

    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ currentPassword, newPassword })
      });

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        if (res.ok) return { success: true };
        return { success: false, error: data.error || 'Falha ao alterar senha.' };
      }
    } catch {
      // Fallback for Netlify
    }

    clientStorage.resetPassword(user.id, newPassword);
    return { success: true };
  };

  const isAuthenticated = !!user;
  const isAdmin = user?.role === 'admin';

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated,
        isAdmin,
        loading,
        login,
        logout,
        changePassword
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
