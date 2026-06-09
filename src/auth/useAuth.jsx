// src/auth/useAuth.jsx
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";

// keep localStorage scoped per signed-in user
import { setStorageUserId } from "../utils/storage";

const AuthContext = createContext(null);

function withTimeout(promise, ms, label = "Request") {
  let t;

  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

function normEmail(v) {
  return String(v || "").trim().toLowerCase();
}

function fallbackUsernameFromEmail(email) {
  const prefix = String(email || "").split("@")[0] || "golfer";
  return prefix.trim() || "golfer";
}

async function ensureProfileForUser(user) {
  if (!user?.id) return null;

  const email = normEmail(user.email || "");

  const username =
    String(user.user_metadata?.username || "").trim() ||
    String(user.user_metadata?.display_name || "").trim() ||
    fallbackUsernameFromEmail(email);

  const payload = {
    id: user.id,
    email,
    username,
    display_name: username,
  };

  try {
    const { data, error } = await withTimeout(
      supabase
        .from("profiles")
        .upsert(payload, { onConflict: "id" })
        .select("id, email, username, display_name, avatar_url, handicap_index, active_league_id, created_at")
        .maybeSingle(),
      20000,
      "Ensure profile"
    );

    if (error) return null;
    return data ?? null;
  } catch {
    return null;
  }
}

async function fetchMyProfile(userId, user = null) {
  if (!userId) return null;

  try {
    const { data, error } = await withTimeout(
      supabase
        .from("profiles")
        .select("id, email, username, display_name, avatar_url, handicap_index, active_league_id, created_at")
        .eq("id", userId)
        .maybeSingle(),
      20000,
      "Load profile"
    );

    if (!error && data) return data;

    // If missing or RLS timing issue, try to repair profile row.
    if (user?.id) {
      return await ensureProfileForUser(user);
    }

    return null;
  } catch {
    if (user?.id) {
      return await ensureProfileForUser(user);
    }

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
      if (k.startsWith("sb-") && k.includes("-auth-token")) {
        window.localStorage.removeItem(k);
      }

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

    const p = await fetchMyProfile(userId, user);

    if (mountedRef.current && p) {
      setProfile(p);
    }

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
        const { data, error } = await supabase.auth.getSession();

        if (!mountedRef.current) return;

        if (error) {
          // eslint-disable-next-line no-console
          console.error("supabase.auth.getSession error:", error);

          if (isInvalidRefreshTokenError(error)) {
            await safeClearSession("Invalid refresh token during getSession()");
          } else {
            setSession(null);
            setUser(null);
            setStorageUserId(null);
          }

          return;
        }

        const s = data?.session ?? null;
        const u = s?.user ?? null;

        setSession(s);
        setUser(u);
        setStorageUserId(u?.id || null);

        if (u?.id) {
          const p = await fetchMyProfile(u.id, u);

          if (!mountedRef.current) return;

          if (p) {
            setProfile(p);
          } else {
            setProfile(null);
          }
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
          setSession(null);
          setUser(null);
          setStorageUserId(null);
        }
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    };

    bootstrap();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!mountedRef.current) return;

      const u = newSession?.user ?? null;

      setSession(newSession ?? null);
      setUser(u);
      setStorageUserId(u?.id || null);

      if (!u?.id) {
        setProfile(null);
        return;
      }

      const p = await fetchMyProfile(u.id, u);

      if (!mountedRef.current) return;

      if (p) {
        setProfile(p);
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

  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider />");
  }

  return ctx;
}