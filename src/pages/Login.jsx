// src/pages/Login.jsx
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { signIn } from "../auth/auth";
import { useAuth } from "../auth/useAuth";
import { supabase } from "../lib/supabaseClient";

function humanAuthError(message) {
  const msg = String(message || "").toLowerCase();

  if (msg.includes("invalid login credentials")) {
    return "Email or password is incorrect.";
  }

  if (msg.includes("email not confirmed")) {
    return "Please confirm your email before logging in.";
  }

  if (msg.includes("too many requests")) {
    return "Too many attempts. Try again in a moment.";
  }

  if (msg.includes("network") || msg.includes("failed to fetch")) {
    return "Network issue — check your connection and try again.";
  }

  if (msg.includes("no session")) {
    return "Login didn’t stick. Refresh and try again.";
  }

  return "Login failed. Please try again.";
}

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading } = useAuth();

  const fromPath = useMemo(() => {
    const maybe = location.state?.from?.pathname;

    if (!maybe || maybe === "/login" || maybe === "/signup") {
      return "/";
    }

    return maybe;
  }, [location.state]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [authStuck, setAuthStuck] = useState(false);

  useEffect(() => {
    if (!loading) {
      setAuthStuck(false);
      return;
    }

    const timer = setTimeout(() => {
      setAuthStuck(true);
    }, 3500);

    return () => clearTimeout(timer);
  }, [loading]);

  useEffect(() => {
    if (user) {
      navigate(fromPath, { replace: true });
    }
  }, [user, navigate, fromPath]);

  async function handleSubmit(e) {
    e.preventDefault();

    if (busy) return;

    const cleanEmail = email.trim();

    if (!cleanEmail || !password) {
      setError("Enter your email and password.");
      return;
    }

    setError("");
    setBusy(true);

    try {
      await signIn({
        email: cleanEmail,
        password,
      });

      const { data, error: sessionError } =
        await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      if (!data?.session) {
        throw new Error("No session created after login");
      }

      setTimeout(() => {
        setBusy(false);
      }, 1200);
    } catch (err) {
      setError(humanAuthError(err?.message));
      setBusy(false);
    }
  }

  const showLoadingGate = loading && !authStuck;

  if (showLoadingGate) {
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
            Welcome back
          </h1>

          <p className="mt-2 max-w-xs text-sm font-semibold leading-6 text-slate-600">
            Log in to manage your leagues, submit rounds and join the golf banter.
          </p>
        </div>

        <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-[0_20px_50px_rgba(15,23,42,0.10)]">
          {authStuck ? (
            <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-5 text-amber-900">
              Authentication is taking longer than expected. You can still try logging in.
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-4">
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
              <div className="flex items-center justify-between gap-3">
                <label className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                  Password
                </label>

                <Link
                  to="/forgot-password"
                  className="text-xs font-extrabold text-emerald-700 hover:text-emerald-800"
                >
                  Forgot password?
                </Link>
              </div>

              <input
                type="password"
                required
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                autoComplete="current-password"
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
              {busy ? "Logging in…" : "Log in"}
            </button>
          </form>

          <p className="mt-5 text-center text-sm font-semibold text-slate-600">
            New to Golfers Unite?{" "}
            <Link
              to="/signup"
              className="font-extrabold text-emerald-700 hover:text-emerald-800"
            >
              Create an account
            </Link>
          </p>

          {busy ? (
            <p className="mt-3 text-center text-xs font-semibold text-slate-500">
              Signing you in…
            </p>
          ) : null}
        </div>

        <p className="mt-5 text-center text-xs font-semibold text-slate-500">
          Golf-only leagues, scores and banter.
        </p>
      </div>
    </div>
  );
}