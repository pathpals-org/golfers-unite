// src/auth/auth.js
import { supabase } from "../lib/supabaseClient";
import { getStorageUserId, setStorageUserId, KEYS } from "../utils/storage";

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

/**
 * ✅ Clear *scoped* app caches for the current storage user.
 * Your storage.js scopes keys like: `${uid}::${baseKey}`
 * So clearing plain "users" etc does NOTHING once scoping exists.
 */
function clearScopedAppCachesForUser(userId) {
  try {
    if (typeof window === "undefined") return;
    if (!userId) return;

    const prefix = `${String(userId)}::`;
    const keys = Object.keys(window.localStorage);

    keys.forEach((k) => {
      if (k.startsWith(prefix)) window.localStorage.removeItem(k);
    });
  } catch {
    // ignore
  }
}

/**
 * ✅ Clear any legacy/unscoped caches (best-effort)
 * (kept because you had these in earlier versions)
 */
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

      // also clear unscoped active league id if it ever existed
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

/**
 * Signup flow:
 * 1) Create auth user
 * 2) Best-effort create/Upsert matching profiles row
 *
 * ✅ IMPORTANT:
 * If email confirmation is enabled, a session may NOT exist yet.
 * In that case, profile upsert can be blocked by RLS.
 * So we attempt it, but we NEVER let it break signup success.
 */
export async function signUp({ email, password, username }) {
  const cleanEmail = normEmail(email);
  const cleanUsername = normUsername(username);

  if (!cleanEmail.includes("@")) throw new Error("Please enter a valid email.");
  if (!password || String(password).length < 6) throw new Error("Password must be at least 6 characters.");
  if (!cleanUsername) throw new Error("Please enter a username.");

  const { data, error } = await supabase.auth.signUp({
    email: cleanEmail,
    password,
  });

  if (error) throw error;

  const user = data?.user ?? null;
  if (!user?.id) throw new Error("No user returned from signUp");

  // ✅ Best-effort profile row (fail-soft if RLS blocks due to no session)
  try {
    await supabase.from("profiles").upsert(
      {
        id: user.id,
        email: user.email ?? cleanEmail,
        username: cleanUsername,
        display_name: cleanUsername,
      },
      { onConflict: "id" }
    );
  } catch {
    // ignore — profile can be created later or via trigger
  }

  return user;
}

export async function signIn({ email, password }) {
  const cleanEmail = normEmail(email);

  const { data, error } = await supabase.auth.signInWithPassword({
    email: cleanEmail,
    password,
  });

  if (error) throw error;

  // ✅ Immediately scope storage to this user to prevent cross-account bleed
  const uid = data?.user?.id || null;
  if (uid) setStorageUserId(uid);

  return data?.user ?? null;
}

/**
 * Normal sign out:
 * - calls supabase signOut
 * - clears supabase tokens (best-effort)
 * - clears scoped app caches for the currently scoped storage user
 * - clears legacy caches
 * - unsets storage user id
 */
export async function signOut() {
  // Grab current storage scope BEFORE we clear it
  const scopedUid = getStorageUserId();

  try {
    await supabase.auth.signOut();
  } catch {
    // ignore
  } finally {
    clearSupabaseAuthStorageKeys();

    if (scopedUid) clearScopedAppCachesForUser(scopedUid);

    clearLegacyIdentityCaches();
    setStorageUserId(null);
  }
}

/**
 * ✅ Hard sign out:
 * Use this if you ever get stuck in a broken auth state.
 * It nukes tokens and caches even if supabase.signOut fails.
 */
export async function hardSignOut() {
  const scopedUid = getStorageUserId();

  try {
    await supabase.auth.signOut();
  } catch {
    // ignore
  } finally {
    clearSupabaseAuthStorageKeys();
    if (scopedUid) clearScopedAppCachesForUser(scopedUid);
    clearLegacyIdentityCaches();
    setStorageUserId(null);

    // Hard reload guarantees app state is clean
    if (typeof window !== "undefined") window.location.href = "/login";
  }
}


