// src/auth/useAuth.jsx
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const AuthContext = createContext(null);

function withTimeout(promise, ms, label = "Request") {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

async function fetchMyProfile(userId) {
  if (!userId) return null;

  // ✅ Never allow profile fetch to hang forever
  const { data, error } = await withTimeout(
    supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url, handicap_index, created_at, updated_at")
      .eq("id", userId)
      .maybeSingle(),
    8000,
    "Load profile"
  );

  // RLS block or missing row = null (never block UI)
  if (error) return null;
  return data ?? null;
}

function isInvalidRefreshTokenError(err) {
  const msg = String(err?.message || err?.error_description || err || "").toLowerCase();
  return (
    msg.includes("invalid refresh token") ||
    msg.includes("refresh token not found") ||
    msg.includes("invalid token")
  );
}

// Backup cleanup for cases where signOut can't run cleanly
function clearSupabaseAuthStorageKeys() {
  try {
    const keys = Object.keys(localStorage);
    keys.forEach((k) => {
      // Supabase v2 stores tokens under sb-<project-ref>-auth-token
      if (k.startsWith("sb-") && k.includes("-auth-token")) localStorage.removeItem(k);

      // Extra safety (some setups)
      if (k.toLowerCase().includes("supabase") && k.toLowerCase().includes("auth")) {
        localStorage.removeItem(k);
      }
    });
  } catch {
    // ignore
  }
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

    // ✅ Safety: never allow infinite loading
    const watchdog = setTimeout(() => {
      if (mountedRef.current) setLoading(false);
    }, 4500);

    const safeClearSession = async (reason) => {
      try {
        console.warn("Clearing auth session:", reason);
        await supabase.auth.signOut();
      } catch (e) {
        console.warn("supabase.auth.signOut failed, doing local cleanup:", e);
      } finally {
        clearSupabaseAuthStorageKeys();
        if (!mountedRef.current) return;
        setSession(null);
        setUser(null);
        setProfile(null);
      }
    };

    const bootstrap = async () => {
      setLoading(true);

      try {
        /**
         * ✅ Use getSession() first (LOCAL)
         * This does NOT require a network request, so it won’t hang behind blockers.
         */
        const { data, error } = await withTimeout(
          supabase.auth.getSession(),
          3000,
          "Auth session"
        );

        if (!mountedRef.current) return;

        if (error) {
          console.error("supabase.auth.getSession error:", error);
          if (isInvalidRefreshTokenError(error)) {
            await safeClearSession("Invalid refresh token during getSession()");
          } else {
            setSession(null);
            setUser(null);
            setProfile(null);
          }
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

        if (isInvalidRefreshTokenError(e)) {
          await safeClearSession("Invalid refresh token thrown during bootstrap");
        } else {
          // If session read times out, fail open (no user), don’t hang the app
          setSession(null);
          setUser(null);
          setProfile(null);
        }
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };

    bootstrap();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!mountedRef.current) return;

      // ✅ Don’t keep the whole app in “loading” during events.
      // Just update state quickly; profile fetch is still protected by timeout.
      setSession(newSession ?? null);
      setUser(newSession?.user ?? null);

      try {
        if (newSession?.user?.id) {
          const p = await fetchMyProfile(newSession.user.id);
          if (!mountedRef.current) return;
          setProfile(p);
        } else {
          setProfile(null);
        }
      } catch (e) {
        console.error("Profile refresh after auth change failed:", e);
        if (!mountedRef.current) return;

        if (isInvalidRefreshTokenError(e)) {
          await safeClearSession("Invalid refresh token during onAuthStateChange");
        } else {
          setProfile(null);
        }
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    });

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

