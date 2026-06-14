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
    return "Password is too weak. Try at least 8 characters.";
  }

  if (msg.includes("network") || msg.includes("failed to fetch")) {
    return "Network issue — check your connection and try again.";
  }

  return "Signup failed. Please try again.";
}

export default function Signup() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading, refreshProfile } = useAuth();

  const fromPath = useMemo(() => {
    const maybe = location.state?.from?.pathname;

    if (!maybe || maybe === "/login" || maybe === "/signup") {
      return "/";
    }

    return maybe;
  }, [location.state]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsEmailConfirm, setNeedsEmailConfirm] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      refreshProfile(user.id);
      navigate(fromPath, { replace: true });
    }
  }, [user, loading, navigate, fromPath, refreshProfile]);

  async function handleSubmit(e) {
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
      await signUp({
        email: cleanEmail,
        password,
        username: cleanUsername,
      });

      const { data, error: sessionError } =
        await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      if (data?.session) {
        navigate(fromPath, { replace: true });
        return;
      }

      setNeedsEmailConfirm(true);
    } catch (err) {
      setError(humanAuthError(err?.message));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10">
        <div className="mx-auto max-w-sm rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-extrabold text-slate-900">
            Loading…
          </p>

          <p className="mt-1 text-xs font-semibold text-slate-600">
            Just setting things up.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-100 px-4 py-8 sm:py-12">
      <div className="pointer-events-none absolute -top-36 left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-emerald-500/10 blur-3xl" />

      <div className="relative mx-auto w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="relative grid h-16 w-16 place-items-center overflow-hidden rounded-3xl bg-emerald-600 text-3xl text-white shadow-lg ring-1 ring-emerald-700/20">
            <span className="relative z-10">⛳</span>
            <span className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/25 to-transparent" />
          </div>

          <h1 className="mt-4 text-2xl font-black tracking-tight text-slate-950">
            Join Golfers Unite
          </h1>

          <p className="mt-2 max-w-xs text-sm font-semibold leading-6 text-slate-600">
            Create your profile, join a league, submit rounds and enjoy proper golf banter.
          </p>
        </div>

        <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-[0_20px_50px_rgba(15,23,42,0.10)]">
          {needsEmailConfirm ? (
            <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-5 text-amber-900">
              Account created ✅ Check your email to confirm your address, then return and log in.
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                Username
              </label>

              <input
                type="text"
                required
                minLength={3}
                placeholder="Choose a username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>

            <div>
              <label className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                Email
              </label>

              <input
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>

            <div>
              <label className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                Password
              </label>

              <input
                type="password"
                required
                minLength={8}
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                autoComplete="new-password"
              />
            </div>

            {error ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-extrabold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Creating account…" : "Create account"}
            </button>
          </form>

          <p className="mt-5 text-center text-sm font-semibold text-slate-600">
            Already have an account?{" "}
            <Link
              to="/login"
              className="font-extrabold text-emerald-700 hover:text-emerald-800"
            >
              Log in
            </Link>
          </p>
        </div>

        <p className="mt-5 text-center text-xs font-semibold text-slate-500">
          Golf-only leagues, scores and banter.
        </p>
      </div>
    </div>
  );
}