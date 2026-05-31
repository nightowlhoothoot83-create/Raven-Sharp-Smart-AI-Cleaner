import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api, getToken, setToken } from "./api";

type User = { id: string; email: string; full_name?: string | null };

type AuthCtx = {
  user: User | null;
  ready: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName?: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const t = await getToken();
        if (t) {
          const u = await api.me();
          setUser(u);
        }
      } catch {
        await setToken(null);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const signIn = async (email: string, password: string) => {
    const r = await api.login(email, password);
    await setToken(r.access_token);
    setUser(r.user);
  };
  const signUp = async (email: string, password: string, fullName?: string) => {
    const r = await api.signup(email, password, fullName);
    await setToken(r.access_token);
    setUser(r.user);
  };
  const signOut = async () => {
    await setToken(null);
    setUser(null);
  };

  return <Ctx.Provider value={{ user, ready, signIn, signUp, signOut }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}
