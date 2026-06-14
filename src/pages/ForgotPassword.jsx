// src/pages/ForgotPassword.jsx
import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

function humanError(message) {
  const msg = String(message || "").toLowerCase();

  if (msg.includes("too many requests")) {
    return "Too many reset attempts. Wait a minute and try again.";
  }

  if (msg.includes("network") || msg.includes("failed to fetch")) {
    return "Network issue — check your connection and try again.";
  }

  return "Couldn’t send the reset email. Please try again.";
}

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({
    type: "",
    message: "",
  });

  async function handleSubmit(e) {
    e.preventDefault();

    if (busy) return;

    const cleanEmail = email.trim();

    if (!cleanEmail) {
      setStatus({
        type: "error",
        message: "Enter your email address.",
      });
      return;
    }

    setBusy(true);
    setStatus({ type: "", message: "" });

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) throw error;

      setStatus({
        type: "success",
        message:
          "Reset email sent ✅ Check your inbox and tap the link to choose a new password.",
      });
    } catch (err) {
      setStatus({
        type: "error",
        message: humanError(err?.message),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-10 max-w-sm rounded-2xl bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-slate-900">
        Reset your password
      </h1>

      <p className="mt-1 text-sm text-slate-600">
        Enter your account email and we’ll send you a reset link.
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

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {busy ? "Sending…" : "Send reset email"}
        </button>
      </form>

      <p className="mt-4 text-sm text-slate-600">
        Remembered it?{" "}
        <Link to="/login" className="font-semibold text-emerald-600">
          Back to login
        </Link>
      </p>
    </div>
  );
}