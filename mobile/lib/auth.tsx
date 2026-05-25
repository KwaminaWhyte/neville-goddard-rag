// Auth context: token storage (SecureStore) + current user hydration.
// The single source of truth for the `User` shape lives here; lib/api.ts
// re-exports it.
import * as SecureStore from "expo-secure-store";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import * as api from "./api";

export type User = {
  id: number;
  email: string;
  name: string | null;
  avatar: string | null;
  created_at: string;
};

const TOKEN_KEY = "neville_token";

type AuthContextValue = {
  user: User | null;
  token: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name?: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Hydrate on mount.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync(TOKEN_KEY);
        if (stored) {
          api.setAuthToken(stored);
          if (active) setToken(stored);
          try {
            const { user } = await api.me();
            if (active) setUser(user);
          } catch {
            // Invalid / expired token — clear it.
            await SecureStore.deleteItemAsync(TOKEN_KEY);
            api.setAuthToken(null);
            if (active) {
              setToken(null);
              setUser(null);
            }
          }
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const persist = async (tok: string, usr: User) => {
    await SecureStore.setItemAsync(TOKEN_KEY, tok);
    api.setAuthToken(tok);
    setToken(tok);
    setUser(usr);
  };

  const signIn = useCallback(async (email: string, password: string) => {
    const { user, token } = await api.login(email, password);
    await persist(token, user);
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, name?: string) => {
      const { user, token } = await api.signup(email, password, name);
      await persist(token, user);
    },
    []
  );

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // best-effort
    }
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    api.setAuthToken(null);
    setToken(null);
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    const { user } = await api.me();
    setUser(user);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, token, loading, signIn, signUp, signOut, refresh }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
