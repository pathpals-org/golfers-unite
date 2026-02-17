// src/auth/useAuth.jsx
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";

// ✅ keep localStorage scoped per signed-in user (prevents cross-account bleed)
import { setStorageUserId } from "../utils/storage";

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

  // ✅ Profiles fetch is allowed to time out WITHOUT breaking auth.
  try {
    const { data, error } = await withTimeout(
      supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url, handicap_index, created_at")
        .eq("id", userId)
        .maybeSingle(),
      20000,
      "Load profile"
    );

    // RLS block or missing row = null (never block UI)
    if (error) return null;
    return data ?? null;
  } catch {
    return null;
  }
}

function isInvalidRefreshTokenError(err) {
  const msg = String(err?.message || err?.error_description || err || "").toLowerCase();
  return (
    msg.includes("invalid refresh token") ||
    msg.includes("refresh token not found") ||
    msg.includes("invalid token")
  );
}

function clearSupabaseAuthStorageKeys() {
  try {
    if (typeof window === "undefined") return;
    const keys = Object.keys(window.localStorage);
    keys.forEach((k) => {
      if (k.startsWith("sb-") && k.includes("-auth-token")) window.localStorage.removeItem(k);
      if (k.toLowerCase().includes("supabase") && k.toLowerCase().includes("auth")) {
        window.localStorage.removeItem(k);
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
    if (!userId) return null;

    const p = await fetchMyProfile(userId);
    if (mountedRef.current && p) setProfile(p);
    return p;
  };

  useEffect(() => {
    mountedRef.current = true;

    const safeClearSession = async (reason) => {
      try {
        // eslint-disable-next-line no-console
        console.warn("Clearing auth session:", reason);
        await supabase.auth.signOut();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("supabase.auth.signOut failed, doing local cleanup:", e);
      } finally {
        clearSupabaseAuthStorageKeys();
        setStorageUserId(null);

        if (!mountedRef.current) return;
        setSession(null);
        setUser(null);
        setProfile(null);
      }
    };

    const bootstrap = async () => {
      setLoading(true);

      try {
        // ✅ IMPORTANT: DO NOT timeout getSession().
        // Timeouts here cause “signed in but user null” when Supabase is just slow.
        const { data, error } = await supabase.auth.getSession();

        if (!mountedRef.current) return;

        if (error) {
          // eslint-disable-next-line no-console
          console.error("supabase.auth.getSession error:", error);

          if (isInvalidRefreshTokenError(error)) {
            await safeClearSession("Invalid refresh token during getSession()");
          } else {
            // fail-soft: treat as no session without nuking storage
            setSession(null);
            setUser(null);
            setStorageUserId(null);
            // keep profile as-is (don’t force null)
          }
          return;
        }

        const s = data?.session ?? null;
        setSession(s);
        setUser(s?.user ?? null);
        setStorageUserId(s?.user?.id || null);

        if (s?.user?.id) {
          const p = await fetchMyProfile(s.user.id);
          if (!mountedRef.current) return;
          if (p) setProfile(p);
        } else {
          setProfile(null);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("Auth bootstrap error:", e);
        if (!mountedRef.current) return;

        if (isInvalidRefreshTokenError(e)) {
          await safeClearSession("Invalid refresh token thrown during bootstrap");
        } else {
          // fail-soft: do not wipe local storage unless you KNOW it’s invalid tokens
          setSession(null);
          setUser(null);
          setStorageUserId(null);
          // keep profile as-is
        }
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };

    bootstrap();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!mountedRef.current) return;

      setSession(newSession ?? null);
      setUser(newSession?.user ?? null);
      setStorageUserId(newSession?.user?.id || null);

      // If signed out
      if (!newSession?.user?.id) {
        setProfile(null);
        return;
      }

      // Profile refresh is fail-soft
      const p = await fetchMyProfile(newSession.user.id);
      if (!mountedRef.current) return;
      if (p) setProfile(p);
    });

    return () => {
      mountedRef.current = false;
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

