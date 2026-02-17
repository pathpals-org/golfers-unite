// src/pages/Signup.jsx
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { signUp } from "../auth/auth";
import { useAuth } from "../auth/useAuth";
import { supabase } from "../lib/supabaseClient";

function humanAuthError(message) {
  const msg = String(message || "").toLowerCase();

  if (msg.includes("user already registered")) {
    return "That email is already registered. Try logging in instead.";
  }
  if (msg.includes("duplicate key") || msg.includes("already exists")) {
    return "That username or email is already taken.";
  }
  if (msg.includes("password")) {
    return "Password is too weak. Try 8+ characters.";
  }
  if (msg.includes("network") || msg.includes("failed to fetch")) {
    return "Network issue — check your connection and try again.";
  }
  return "Signup failed. Please try again.";
}

export default function Signup() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading } = useAuth();

  const fromPath = useMemo(() => {
    const maybe = location.state?.from?.pathname;
    if (!maybe || maybe === "/login" || maybe === "/signup") return "/";
    return maybe;
  }, [location.state]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // If signup requires email confirmation, Supabase may NOT return a session.
  const [needsEmailConfirm, setNeedsEmailConfirm] = useState(false);

  // Already logged in → go where they intended
  useEffect(() => {
    if (!loading && user) {
      navigate(fromPath, { replace: true });
    }
  }, [user, loading, navigate, fromPath]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;

    setError("");
    setNeedsEmailConfirm(false);

    const cleanUsername = username.trim();
    const cleanEmail = email.trim();

    if (cleanUsername.length < 3) {
      setError("Username must be at least 3 characters.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setBusy(true);

    try {
      await signUp({ email: cleanEmail, password, username: cleanUsername });

      // ✅ Sanity check: do we have a session now?
      const { data } = await supabase.auth.getSession();

      if (data?.session) {
        // Session exists → proceed normally
        navigate(fromPath, { replace: true });
        return;
      }

      // No session → email confirmation is likely required
      setNeedsEmailConfirm(true);
    } catch (err) {
      setError(humanAuthError(err?.message));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto mt-10 max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold text-slate-900">Loading…</p>
        <p className="mt-1 text-xs text-slate-600">Just setting things up.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-10 max-w-sm rounded-2xl bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-slate-900">Join Golfers Unite</h1>
      <p className="mt-1 text-sm text-slate-600">Leagues, rounds, and proper golf banter.</p>

      {needsEmailConfirm ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
          Account created ✅ Now check your email to confirm your address, then come back and log in.
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <input
          type="text"
          required
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          autoComplete="username"
        />

        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          autoComplete="email"
          inputMode="email"
        />

        <input
          type="password"
          required
          placeholder="Password (8+ characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          autoComplete="new-password"
        />

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <button
          disabled={busy}
          className="w-full rounded-xl bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {busy ? "Creating account…" : "Sign up"}
        </button>
      </form>

      <p className="mt-4 text-sm text-slate-600">
        Already have an account?{" "}
        <Link to="/login" className="font-semibold text-emerald-600">
          Log in
        </Link>
      </p>
    </div>
  );
}


