// src/auth/auth.js
import { supabase } from "../lib/supabaseClient";
import { getStorageUserId, setStorageUserId, KEYS } from "../utils/storage";

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

function clearScopedAppCachesForUser(userId) {
  try {
    if (typeof window === "undefined") return;
    if (!userId) return;

    const prefix = `${String(userId)}::`;
    const keys = Object.keys(window.localStorage);

    keys.forEach((k) => {
      if (k.startsWith(prefix)) {
        window.localStorage.removeItem(k);
      }
    });
  } catch {
    // ignore
  }
}

function clearLegacyIdentityCaches() {
  try {
    if (typeof window === "undefined") return;

    const keysToRemove = [
      "users",
      "currentUser",
      "currentUserId",
      "activeUser",
      "activeUserId",
      "gu_users",
      "gu_current_user",
      "golfers_unite_users",
      "golfers_unite_current_user",
      KEYS?.activeLeagueId || "__golfers_unite_active_league_id__",
    ];

    keysToRemove.forEach((k) => {
      try {
        window.localStorage.removeItem(k);
      } catch {
        // ignore
      }
    });
  } catch {
    // ignore
  }
}

function normEmail(v) {
  return String(v || "").trim().toLowerCase();
}

function normUsername(v) {
  return String(v || "").trim();
}

function fallbackUsernameFromEmail(email) {
  const prefix = String(email || "").split("@")[0] || "golfer";
  return prefix.trim() || "golfer";
}

/**
 * Ensures profiles row exists for logged-in user.
 * This protects the app if signup profile creation failed due to email confirmation or RLS timing.
 */
async function ensureProfileForUser(user, preferredUsername = "") {
  if (!user?.id) return null;

  const email = normEmail(user.email || "");
  const cleanUsername =
    normUsername(preferredUsername) ||
    normUsername(user.user_metadata?.username) ||
    normUsername(user.user_metadata?.display_name) ||
    fallbackUsernameFromEmail(email);

  const payload = {
    id: user.id,
    email,
    username: cleanUsername,
    display_name: cleanUsername,
  };

  const { data, error } = await supabase
    .from("profiles")
    .upsert(payload, { onConflict: "id" })
    .select("id,email,username,display_name,handicap_index,active_league_id")
    .maybeSingle();

  if (error) {
    // Do not break login/signup because of a profile row issue.
    return null;
  }

  return data || null;
}

export async function signUp({ email, password, username }) {
  const cleanEmail = normEmail(email);
  const cleanUsername = normUsername(username);

  if (!cleanEmail.includes("@")) {
    throw new Error("Please enter a valid email.");
  }

  if (!password || String(password).length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }

  if (!cleanUsername) {
    throw new Error("Please enter a username.");
  }

  const { data, error } = await supabase.auth.signUp({
    email: cleanEmail,
    password,
    options: {
      data: {
        username: cleanUsername,
        display_name: cleanUsername,
      },
    },
  });

  if (error) throw error;

  const user = data?.user ?? null;

  if (!user?.id) {
    throw new Error("No user returned from signUp");
  }

  // Scope storage immediately if Supabase gives a session/user.
  setStorageUserId(user.id);

  // Best-effort profile row. If email confirmation blocks RLS, login will try again.
  await ensureProfileForUser(user, cleanUsername);

  return user;
}

export async function signIn({ email, password }) {
  const cleanEmail = normEmail(email);

  const { data, error } = await supabase.auth.signInWithPassword({
    email: cleanEmail,
    password,
  });

  if (error) throw error;

  const user = data?.user ?? null;
  const uid = user?.id || null;

  if (uid) {
    setStorageUserId(uid);
    await ensureProfileForUser(user);
  }

  return user;
}

export async function signOut() {
  const scopedUid = getStorageUserId();

  try {
    await supabase.auth.signOut();
  } catch {
    // ignore
  } finally {
    clearSupabaseAuthStorageKeys();

    if (scopedUid) {
      clearScopedAppCachesForUser(scopedUid);
    }

    clearLegacyIdentityCaches();
    setStorageUserId(null);
  }
}

export async function hardSignOut() {
  const scopedUid = getStorageUserId();

  try {
    await supabase.auth.signOut();
  } catch {
    // ignore
  } finally {
    clearSupabaseAuthStorageKeys();

    if (scopedUid) {
      clearScopedAppCachesForUser(scopedUid);
    }

    clearLegacyIdentityCaches();
    setStorageUserId(null);

    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
  }
}