// src/pages/Login.jsx
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { signIn } from "../auth/auth";
import { useAuth } from "../auth/useAuth";

function humanAuthError(message) {
  const msg = String(message || "").toLowerCase();

  if (msg.includes("invalid login credentials")) return "Email or password is incorrect.";
  if (msg.includes("email not confirmed")) return "Please confirm your email before logging in.";
  if (msg.includes("too many requests")) return "Too many attempts. Try again in a moment.";
  if (msg.includes("network") || msg.includes("failed to fetch")) {
    return "Network issue — check your connection and try again.";
  }
  return "Login failed. Please try again.";
}

export default function Login() {
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

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // ✅ If auth bootstrap hangs, don’t block the login screen forever
  const [authStuck, setAuthStuck] = useState(false);

  useEffect(() => {
    if (!loading) {
      setAuthStuck(false);
      return;
    }

    const t = setTimeout(() => {
      setAuthStuck(true);
    }, 3500);

    return () => clearTimeout(t);
  }, [loading]);

  // ✅ Redirect only when we truly have a user
  useEffect(() => {
    if (user) {
      navigate(fromPath, { replace: true });
    }
  }, [user, navigate, fromPath]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;

    const e1 = email.trim();
    if (!e1 || !password) return;

    setError("");
    setBusy(true);

    try {
      await signIn({ email: e1, password });

      // ✅ IMPORTANT:
      // Do NOT navigate immediately.
      // Let AuthProvider onAuthStateChange / bootstrap set `user`,
      // then the useEffect above redirects correctly.
    } catch (err) {
      setError(humanAuthError(err?.message));
      setBusy(false);
    }
  };

  const showLoadingGate = loading && !authStuck;

  if (showLoadingGate) {
    return (
      <div className="mx-auto mt-10 max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold text-slate-900">Loading…</p>
        <p className="mt-1 text-xs text-slate-600">Just setting things up.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-10 max-w-sm rounded-2xl bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-slate-900">Welcome back</h1>
      <p className="mt-1 text-sm text-slate-600">Log in to post rounds and talk golf.</p>

      {authStuck ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
          Auth is taking longer than expected. You can still log in — this usually recovers after a refresh.
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />

        <input
          type="password"
          required
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          autoComplete="current-password"
        />

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <button
          disabled={busy}
          className="w-full rounded-xl bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>

      <p className="mt-4 text-sm text-slate-600">
        New here?{" "}
        <Link to="/signup" className="font-semibold text-emerald-600">
          Create an account
        </Link>
      </p>

      {/* ✅ If login succeeded but context hasn’t updated yet, we show a gentle hint */}
      {busy ? (
        <p className="mt-3 text-xs font-semibold text-slate-500">
          Signing you in… if this takes more than a few seconds, refresh the page.
        </p>
      ) : null}
    </div>
  );
}


