// src/auth/useAuth.jsx
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { supabase } from "../lib/supabaseClient";

const AuthContext = createContext(null);

async function fetchMyProfile(userId) {
  if (!userId) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url, created_at, updated_at")
    .eq("id", userId)
    .single();

  // RLS block or missing row = null (never block UI)
  if (error) return null;
  return data ?? null;
}

export function AuthProvider({ children }) {
  const mountedRef = useRef(false);

  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = async (overrideUserId) => {
    const userId = overrideUserId ?? user?.id ?? null;
    if (!userId) {
      setProfile(null);
      return null;
    }
    const p = await fetchMyProfile(userId);
    if (mountedRef.current) setProfile(p);
    return p;
  };

  useEffect(() => {
    mountedRef.current = true;

    // Safety: never allow infinite loading (network/plugin weirdness)
    const watchdog = setTimeout(() => {
      if (mountedRef.current) setLoading(false);
    }, 4000);

    const bootstrap = async () => {
      setLoading(true);

      try {
        const { data, error } = await supabase.auth.getSession();

        if (!mountedRef.current) return;

        if (error) {
          console.error("supabase.auth.getSession error:", error);
          setSession(null);
          setUser(null);
          setProfile(null);
          return;
        }

        const s = data?.session ?? null;
        setSession(s);
        setUser(s?.user ?? null);

        if (s?.user?.id) {
          const p = await fetchMyProfile(s.user.id);
          if (!mountedRef.current) return;
          setProfile(p);
        } else {
          setProfile(null);
        }
      } catch (e) {
        console.error("Auth bootstrap error:", e);
        if (!mountedRef.current) return;
        setSession(null);
        setUser(null);
        setProfile(null);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };

    bootstrap();

    const { data: sub } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        if (!mountedRef.current) return;

        try {
          // Auth events should never cause infinite loading
          setLoading(true);

          setSession(newSession ?? null);
          setUser(newSession?.user ?? null);

          if (newSession?.user?.id) {
            const p = await fetchMyProfile(newSession.user.id);
            if (!mountedRef.current) return;
            setProfile(p);
          } else {
            setProfile(null);
          }
        } catch (e) {
          console.error("onAuthStateChange error:", e);
          if (!mountedRef.current) return;
          setProfile(null);
        } finally {
          if (mountedRef.current) setLoading(false);
        }
      }
    );

    return () => {
      mountedRef.current = false;
      clearTimeout(watchdog);
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  const value = useMemo(
    () => ({
      session,
      user,
      profile,
      loading,
      refreshProfile,
    }),
    [session, user, profile, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider />");
  return ctx;
}


