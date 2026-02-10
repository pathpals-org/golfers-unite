// src/lib/supabaseClient.js
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// In-memory fallback (used only if localStorage is unavailable)
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

// Safe storage wrapper: tries localStorage, falls back to memory
const safeStorage = {
  getItem: (key) => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return memoryStorage.getItem(key);
    }
  },
  setItem: (key, value) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      memoryStorage.setItem(key, value);
    }
  },
  removeItem: (key) => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      memoryStorage.removeItem(key);
    }
  },
};

// --- Helper: trim and validate env values (Netlify sometimes includes whitespace)
function cleanEnv(v) {
  return typeof v === "string" ? v.trim() : "";
}

const url = cleanEnv(supabaseUrl);
const anon = cleanEnv(supabaseAnonKey);

// --- Debug (safe): lets you confirm what the Netlify build actually received
// Check on desktop Netlify console: window.__SUPABASE_ENV__
if (typeof window !== "undefined") {
  window.__SUPABASE_ENV__ = {
    hasUrl: Boolean(url),
    hasAnon: Boolean(anon),
    urlOrigin: url ? (() => {
      try {
        return new URL(url).origin;
      } catch {
        return "INVALID_URL";
      }
    })() : null,
    anonLen: anon ? anon.length : 0,
    buildMode: import.meta.env.MODE,
  };
}

// --- If env is missing, don't hard-crash the whole app — log loudly.
// This prevents “everything looks like localStorage” mystery on production devices.
if (!url || !anon) {
  // eslint-disable-next-line no-console
  console.error(
    "[Supabase] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in this build. " +
      "On Netlify: Site configuration → Environment variables → add both, then Trigger deploy → Clear cache and deploy."
  );
}

// Create the client even if env is missing; calls will fail with clear errors,
// but your UI won't silently fall back to weird states.
export const supabase = createClient(url || "http://localhost:54321", anon || "missing-anon-key", {
  auth: {
    storage: safeStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});



