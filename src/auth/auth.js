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

export async function signUp({ email, password, username }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) throw error;

  const user = data.user;
  if (!user) throw new Error("No user returned from signUp");

  const { error: profileError } = await supabase.from("profiles").insert({
    id: user.id,
    username,
    display_name: username,
  });

  if (profileError) throw profileError;

  return user;
}

export async function signIn({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;
  return data.user;
}

export async function signOut() {
  // Always try “proper” sign-out first
  try {
    await supabase.auth.signOut();
  } catch {
    // ignore
  } finally {
    // Then hard-clear any leftover tokens/cached identity
    clearSupabaseAuthStorageKeys();
    clearIdentityCaches();
  }
}
