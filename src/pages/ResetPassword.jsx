// src/pages/ResetPassword.jsx
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

function humanError(message) {
  const msg = String(message || "").toLowerCase();

  if (msg.includes("password should be at least")) {
    return "Your password must be at least 6 characters long.";
  }

  if (msg.includes("same password")) {
    return "Choose a different password from your current one.";
  }

  if (msg.includes("expired")) {
    return "This reset link has expired. Request a new one.";
  }

  if (msg.includes("network") || msg.includes("failed to fetch")) {
    return "Network issue — check your connection and try again.";
  }

  return "Couldn’t update your password. Please request a new reset link and try again.";
}

export default function ResetPassword() {
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [checkingSession, setCheckingSession] = useState(true);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [busy, setBusy] = useState(false);

  const [status, setStatus] = useState({
    type: "",
    message: "",
  });

  useEffect(() => {
    let mounted = true;

    async function checkSession() {
      const { data } = await supabase.auth.getSession();

      if (!mounted) return;

      setHasRecoverySession(Boolean(data?.session));
      setCheckingSession(false);
    }

    checkSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;

      if (event === "PASSWORD_RECOVERY" || session) {
        setHasRecoverySession(true);
        setCheckingSession(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();

    if (busy) return;

    if (password.length < 6) {
      setStatus({
        type: "error",
        message: "Your password must be at least 6 characters long.",
      });
      return;
    }

    if (password !== confirmPassword) {
      setStatus({
        type: "error",
        message: "The passwords do not match.",
      });
      return;
    }

    setBusy(true);
    setStatus({
      type: "",
      message: "",
    });

    try {
      const { error } = await supabase.auth.updateUser({
        password,
      });

      if (error) throw error;

      setStatus({
        type: "success",
        message: "Password updated successfully ✅",
      });

      await supabase.auth.signOut();

      setTimeout(() => {
        navigate("/login", {
          replace: true,
          state: {
            passwordReset: true,
          },
        });
      }, 1500);
    } catch (err) {
      setStatus({
        type: "error",
        message: humanError(err?.message),
      });
    } finally {
      setBusy(false);
    }
  }

  if (checkingSession) {
    return (
      <div className="mx-auto mt-10 max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold text-slate-900">
          Checking your reset link…
        </p>

        <p className="mt-1 text-xs text-slate-600">
          This should only take a moment.
        </p>
      </div>
    );
  }

  if (!hasRecoverySession) {
    return (
      <div className="mx-auto mt-10 max-w-sm rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">
          Reset link unavailable
        </h1>

        <p className="mt-2 text-sm text-slate-600">
          This reset link may have expired or already been used.
        </p>

        <Link
          to="/forgot-password"
          className="mt-5 inline-flex w-full justify-center rounded-xl bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          Request a new reset link
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-10 max-w-sm rounded-2xl bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-slate-900">
        Choose a new password
      </h1>

      <p className="mt-1 text-sm text-slate-600">
        Enter your new password below.
      </p>

      {status.message ? (
        <div
          className={[
            "mt-4 rounded-xl border px-3 py-2 text-sm font-semibold",
            status.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-rose-200 bg-rose-50 text-rose-900",
          ].join(" ")}
        >
          {status.message}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <input
          type="password"
          required
          minLength={6}
          placeholder="New password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          autoComplete="new-password"
        />

        <input
          type="password"
          required
          minLength={6}
          placeholder="Confirm new password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          autoComplete="new-password"
        />

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {busy ? "Updating…" : "Update password"}
        </button>
      </form>

      <p className="mt-4 text-sm text-slate-600">
        Back to{" "}
        <Link
          to="/login"
          className="font-semibold text-emerald-600"
        >
          login
        </Link>
      </p>
    </div>
  );
}