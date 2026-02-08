// src/auth/auth.js
import { supabase } from "../lib/supabaseClient";

function clearSupabaseAuthStorageKeys() {
  try {
    const keys = Object.keys(localStorage);
    keys.forEach((k) => {
      if (k.startsWith("sb-") && k.includes("-auth-token")) localStorage.removeItem(k);
      if (k.toLowerCase().includes("supabase") && k.toLowerCase().includes("auth")) {
        localStorage.removeItem(k);
      }
    });
  } catch {
    // ignore
  }
}

function clearIdentityCaches() {
  try {
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
    ];
    keysToRemove.forEach((k) => {
      try {
        localStorage.removeItem(k);
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
 * 2) Create/Upsert matching profiles row (so friends search works)
 *
 * IMPORTANT:
 * - We store email in profiles because your Friends page searches profiles.email
 * - We use upsert to avoid “retry creates duplicate” failures
 */
export async function signUp({ email, password, username }) {
  const cleanEmail = normEmail(email);
  const cleanUsername = normUsername(username);

  // Basic client-side safety (don’t rely on this for security)
  if (!cleanEmail.includes("@")) throw new Error("Please enter a valid email.");
  if (!password || String(password).length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }
  if (!cleanUsername) throw new Error("Please enter a username.");

  const { data, error } = await supabase.auth.signUp({
    email: cleanEmail,
    password,
  });

  if (error) {
    // Throw the REAL supabase message so the UI can show it (no more guessing)
    throw error;
  }

  const user = data?.user ?? null;
  if (!user?.id) throw new Error("No user returned from signUp");

  // ✅ Make sure profiles row exists and has email
  const { error: profileError } = await supabase
    .from("profiles")
    .upsert(
      {
        id: user.id,
        email: user.email ?? cleanEmail,
        username: cleanUsername,
        display_name: cleanUsername,
      },
      { onConflict: "id" }
    );

  if (profileError) {
    // If this fails, you’ll see the real DB error in the UI/console
    throw profileError;
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
  return data?.user ?? null;
}

export async function signOut() {
  try {
    await supabase.auth.signOut();
  } catch {
    // ignore
  } finally {
    clearSupabaseAuthStorageKeys();
    clearIdentityCaches();
  }
}

