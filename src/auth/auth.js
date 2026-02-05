import { supabase } from "../lib/supabaseClient";

export async function signUp({ email, password, username }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) throw error;

  const user = data.user;
  if (!user) throw new Error("No user returned from signUp");

  const { error: profileError } = await supabase
    .from("profiles")
    .insert({
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
  await supabase.auth.signOut();
}
