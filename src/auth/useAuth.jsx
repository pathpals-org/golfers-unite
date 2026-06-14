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
import { setStorageUserId } from "../utils/storage";

const AuthContext = createContext(null);

function withTimeout(promise, ms, label = "Request") {
  let timer;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });

  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

function normEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function fallbackUsernameFromEmail(email) {
  const prefix = String(email || "").split("@")[0] || "golfer";
  return prefix.trim() || "golfer";
}

async function createMissingProfile(user) {
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
        .insert(payload)
        .select(
          "id, email, username, display_name, avatar_url, handicap_index, created_at"
        )
        .single(),
      8000,
      "Create profile"
    );

    if (error) {
      const message = String(error.message || "").toLowerCase();

      if (message.includes("duplicate")) {
        return fetchMyProfile(user.id, null);
      }

      return null;
    }

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
        .select(
          "id, email, username, display_name, avatar_url, handicap_index, created_at"
        )
        .eq("id", userId)
        .maybeSingle(),
      8000,
      "Load profile"
    );

    if (!error && data) {
      return data;
    }

    if (user?.id) {
      return createMissingProfile(user);
    }

    return null;
  } catch {
    if (user?.id) {
      return createMissingProfile(user);
    }

    return null;
  }
}

function isInvalidRefreshTokenError(error) {
  const message = String(
    error?.message ||
      error?.error_description ||
      error ||
      ""
  ).toLowerCase();

  return (
    message.includes("invalid refresh token") ||
    message.includes("refresh token not found") ||
    message.includes("invalid token")
  );
}

function clearSupabaseAuthStorageKeys() {
  try {
    if (typeof window === "undefined") return;

    Object.keys(window.localStorage).forEach((key) => {
      if (
        key.startsWith("sb-") &&
        key.includes("-auth-token")
      ) {
        window.localStorage.removeItem(key);
      }

      if (
        key.toLowerCase().includes("supabase") &&
        key.toLowerCase().includes("auth")
      ) {
        window.localStorage.removeItem(key);
      }
    });
  } catch {
    // Ignore storage cleanup errors.
  }
}

export function AuthProvider({ children }) {
  const mountedRef = useRef(false);
  const profileRequestRef = useRef(null);

  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(userToLoad) {
    if (!userToLoad?.id) {
      if (mountedRef.current) {
        setProfile(null);
      }

      return null;
    }

    const requestKey = userToLoad.id;

    if (profileRequestRef.current?.key === requestKey) {
      return profileRequestRef.current.promise;
    }

    const promise = fetchMyProfile(
      userToLoad.id,
      userToLoad
    ).finally(() => {
      if (profileRequestRef.current?.key === requestKey) {
        profileRequestRef.current = null;
      }
    });

    profileRequestRef.current = {
      key: requestKey,
      promise,
    };

    const loadedProfile = await promise;

    if (mountedRef.current && loadedProfile) {
      setProfile(loadedProfile);
    }

    return loadedProfile;
  }

  async function refreshProfile(overrideUserId) {
    const userId =
      overrideUserId ??
      user?.id ??
      null;

    if (!userId) return null;

    const loadedProfile = await fetchMyProfile(
      userId,
      user
    );

    if (mountedRef.current && loadedProfile) {
      setProfile(loadedProfile);
    }

    return loadedProfile;
  }

  useEffect(() => {
    mountedRef.current = true;

    async function safeClearSession(reason) {
      try {
        console.warn("Clearing auth session:", reason);
        await supabase.auth.signOut();
      } catch (error) {
        console.warn(
          "Supabase sign-out failed. Clearing locally.",
          error
        );
      } finally {
        clearSupabaseAuthStorageKeys();
        setStorageUserId(null);

        if (!mountedRef.current) return;

        setSession(null);
        setUser(null);
        setProfile(null);
      }
    }

    async function bootstrap() {
      setLoading(true);

      try {
        const { data, error } =
          await supabase.auth.getSession();

        if (!mountedRef.current) return;

        if (error) {
          console.error(
            "Supabase getSession error:",
            error
          );

          if (isInvalidRefreshTokenError(error)) {
            await safeClearSession(
              "Invalid refresh token during startup"
            );
          } else {
            setSession(null);
            setUser(null);
            setProfile(null);
            setStorageUserId(null);
          }

          return;
        }

        const nextSession = data?.session ?? null;
        const nextUser = nextSession?.user ?? null;

        setSession(nextSession);
        setUser(nextUser);
        setStorageUserId(nextUser?.id || null);

        // Do not block the entire app while the profile loads.
        setLoading(false);

        if (nextUser?.id) {
          loadProfile(nextUser);
        } else {
          setProfile(null);
        }
      } catch (error) {
        console.error("Auth startup error:", error);

        if (!mountedRef.current) return;

        if (isInvalidRefreshTokenError(error)) {
          await safeClearSession(
            "Invalid refresh token during startup"
          );
        } else {
          setSession(null);
          setUser(null);
          setProfile(null);
          setStorageUserId(null);
        }
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    }

    bootstrap();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        if (!mountedRef.current) return;

        const nextUser =
          newSession?.user ?? null;

        setSession(newSession ?? null);
        setUser(nextUser);
        setStorageUserId(nextUser?.id || null);
        setLoading(false);

        if (!nextUser?.id) {
          setProfile(null);
          return;
        }

        loadProfile(nextUser);
      }
    );

    return () => {
      mountedRef.current = false;
      subscription?.unsubscribe();
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
    [
      session,
      user,
      profile,
      loading,
    ]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error(
      "useAuth must be used inside <AuthProvider />"
    );
  }

  return context;
}