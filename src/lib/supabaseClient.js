// src/lib/supabaseClient.js
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// In-memory fallback used only if localStorage is unavailable
const memoryStorage = (() => {
  const store = {};

  return {
    getItem: (key) => (key in store ? store[key] : null),

    setItem: (key, value) => {
      store[key] = value;
    },

    removeItem: (key) => {
      delete store[key];
    },
  };
})();

// Robust browser check
const hasWindow = typeof window !== "undefined";

// Safe storage wrapper: tries localStorage, falls back to memory
const safeStorage = {
  getItem: (key) => {
    if (!hasWindow) return memoryStorage.getItem(key);

    try {
      return window.localStorage.getItem(key);
    } catch {
      return memoryStorage.getItem(key);
    }
  },

  setItem: (key, value) => {
    if (!hasWindow) {
      memoryStorage.setItem(key, value);
      return;
    }

    try {
      window.localStorage.setItem(key, value);
    } catch {
      memoryStorage.setItem(key, value);
    }
  },

  removeItem: (key) => {
    if (!hasWindow) {
      memoryStorage.removeItem(key);
      return;
    }

    try {
      window.localStorage.removeItem(key);
    } catch {
      memoryStorage.removeItem(key);
    }
  },
};

function cleanEnv(v) {
  return typeof v === "string" ? v.trim() : "";
}

const url = cleanEnv(supabaseUrl);
const anon = cleanEnv(supabaseAnonKey);

// Safe debug helper so you can check the Netlify build received env vars.
// In browser console, type: window.__SUPABASE_ENV__
if (hasWindow) {
  window.__SUPABASE_ENV__ = {
    hasUrl: Boolean(url),
    hasAnon: Boolean(anon),
    urlOrigin: url
      ? (() => {
          try {
            return new URL(url).origin;
          } catch {
            return "INVALID_URL";
          }
        })()
      : null,
    anonLen: anon ? anon.length : 0,
    buildMode: import.meta.env.MODE,
  };
}

if (!url || !anon) {
  // eslint-disable-next-line no-console
  console.error(
    "[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. " +
      "On Netlify, go to Site configuration → Environment variables, add both values, then redeploy."
  );
}

const FALLBACK_URL = "https://invalid.supabase.local";
const FALLBACK_ANON = "missing-anon-key";

// Keep false unless you use magic links or OAuth redirects
const DETECT_SESSION_IN_URL = false;

export const supabase = createClient(url || FALLBACK_URL, anon || FALLBACK_ANON, {
  auth: {
    storage: safeStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: DETECT_SESSION_IN_URL,
  },
});

// Debug: proves this file loaded in the production bundle.
// In browser console, type: window.__SUPABASE_DEBUG__
if (hasWindow) {
  window.supabase = supabase;

  window.__SUPABASE_DEBUG__ = {
    attached: true,
    tag: "SUPABASE_CLIENT_ATTACHED_v2",
    at: new Date().toISOString(),
  };
}

export default supabase;