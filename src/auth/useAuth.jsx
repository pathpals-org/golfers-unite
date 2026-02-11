// src/auth/useAuth.jsx
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";

// ✅ NEW: keep localStorage scoped per signed-in user (prevents cross-account bleed)
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

  // ✅ Profile fetch can hang (network/RLS). Keep timeout.
  const { data, error } = await withTimeout(
    supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url, handicap_index, created_at, updated_at")
      .eq("id", userId)
      .maybeSingle(),
    15000,
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

    const safeClearSession = async (reason) => {
      try {
        console.warn("Clearing auth session:", reason);
        await supabase.auth.signOut();
      } catch (e) {
        console.warn("supabase.auth.signOut failed, doing local cleanup:", e);
      } finally {
        clearSupabaseAuthStorageKeys();

        // ✅ ensure storage is unscoped after logout / invalid tokens
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
        /**
         * ✅ getSession() should be local, but can be slow on some devices/browsers.
         * The old 3000ms timeout is too aggressive for production.
         */
        const { data, error } = await withTimeout(
          supabase.auth.getSession(),
          15000,
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

            // ✅ no authed user => unscoped storage
            setStorageUserId(null);
          }
          return;
        }

        const s = data?.session ?? null;
        setSession(s);
        setUser(s?.user ?? null);

        // ✅ set storage user id as early as possible (key scoping)
        setStorageUserId(s?.user?.id || null);

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
          // If session read times out/fails, fail open (no user), don’t hang the app
          setSession(null);
          setUser(null);
          setProfile(null);

          // ✅ no confirmed user => unscoped storage
          setStorageUserId(null);
        }
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };

    bootstrap();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!mountedRef.current) return;

      // ✅ Keep UI responsive; don’t lock app in loading on auth events
      setSession(newSession ?? null);
      setUser(newSession?.user ?? null);

      // ✅ Always keep storage scoping aligned with auth state
      setStorageUserId(newSession?.user?.id || null);

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
