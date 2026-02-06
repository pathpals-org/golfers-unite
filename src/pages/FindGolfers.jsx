// src/pages/FindGolfers.jsx
import { useEffect, useMemo, useState } from "react";
import PageHeader from "../components/ui/PageHeader";
import Card from "../components/ui/Card";
import EmptyState from "../components/ui/EmptyState";
import { supabase } from "../lib/supabaseClient";

function ensureArr(v) {
  return Array.isArray(v) ? v : [];
}

function normEmail(v) {
  return String(v || "").trim().toLowerCase();
}

function isValidEmail(v) {
  const s = normEmail(v);
  return s.length >= 5 && s.includes("@") && s.includes(".");
}

function humanErr(e) {
  return e?.message || String(e || "Something went wrong.");
}

function shortName(p) {
  return p?.display_name || (p?.email ? p.email.split("@")[0] : "Golfer");
}

function pairLowHigh(a, b) {
  const A = String(a || "");
  const B = String(b || "");
  return A < B ? { user_low: A, user_high: B } : { user_low: B, user_high: A };
}

function withTimeout(promise, ms, label = "Request") {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

export default function FindGolfers() {
  const [authId, setAuthId] = useState(null);
  const [meProfile, setMeProfile] = useState(null);

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState({ type: "", message: "" });

  const [friendships, setFriendships] = useState([]);
  const [profilesById, setProfilesById] = useState({});

  const [email, setEmail] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const incoming = useMemo(() => {
    return friendships.filter((f) => f.status === "pending" && f.addressee_id === authId);
  }, [friendships, authId]);

  const outgoing = useMemo(() => {
    return friendships.filter((f) => f.status === "pending" && f.requester_id === authId);
  }, [friendships, authId]);

  const friends = useMemo(() => {
    return friendships.filter((f) => f.status === "accepted");
  }, [friendships]);

  function otherId(row) {
    if (!row || !authId) return null;
    return row.requester_id === authId ? row.addressee_id : row.requester_id;
  }

  async function loadMeAndFriends() {
    setLoading(true);
    setStatus({ type: "", message: "" });

    try {
      // ✅ getSession is reliable + fast; wrap in timeout so we never hang forever
      const sessionRes = await withTimeout(
        supabase.auth.getSession(),
        8000,
        "Auth session"
      );

      const uid = sessionRes?.data?.session?.user?.id || null;
      setAuthId(uid);

      if (!uid) {
        setFriendships([]);
        setProfilesById({});
        setMeProfile(null);
        setStatus({ type: "error", message: "You’re not logged in." });
        return;
      }

      // My profile
      const meRes = await withTimeout(
        supabase
          .from("profiles")
          .select("id,email,display_name,created_at")
          .eq("id", uid)
          .maybeSingle(),
        8000,
        "Load profile"
      );

      if (meRes.error) throw meRes.error;
      setMeProfile(meRes.data || null);

      // Friendships
      const frRes = await withTimeout(
        supabase
          .from("friendships")
          .select("id,user_low,user_high,requester_id,addressee_id,status,created_at,updated_at")
          .or(`requester_id.eq.${uid},addressee_id.eq.${uid}`)
          .order("updated_at", { ascending: false }),
        8000,
        "Load friendships"
      );

      if (frRes.error) throw frRes.error;

      const rows = ensureArr(frRes.data);
      setFriendships(rows);

      // Other profiles
      const ids = Array.from(new Set(rows.map((r) => otherId(r)).filter(Boolean)));

      if (!ids.length) {
        setProfilesById({});
        return;
      }

      const profRes = await withTimeout(
        supabase
          .from("profiles")
          .select("id,email,display_name,created_at")
          .in("id", ids),
        8000,
        "Load friend profiles"
      );

      if (profRes.error) throw profRes.error;

      const map = {};
      ensureArr(profRes.data).forEach((p) => {
        if (!p?.id) return;
        map[p.id] = p;
      });
      setProfilesById(map);
    } catch (e) {
      setStatus({ type: "error", message: humanErr(e) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMeAndFriends();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sendFriendRequest() {
    const targetEmail = normEmail(email);

    if (!authId) {
      setStatus({ type: "error", message: "You’re not logged in." });
      return;
    }
    if (!isValidEmail(targetEmail)) {
      setStatus({ type: "error", message: "Enter a valid email." });
      return;
    }
    if (meProfile?.email && normEmail(meProfile.email) === targetEmail) {
      setStatus({ type: "error", message: "You can’t add yourself." });
      return;
    }

    setActionLoading(true);
    setStatus({ type: "", message: "" });

    try {
      const profRes = await withTimeout(
        supabase
          .from("profiles")
          .select("id,email,display_name")
          .eq("email", targetEmail)
          .maybeSingle(),
        8000,
        "Find profile by email"
      );

      if (profRes.error) throw profRes.error;

      const prof = profRes.data;
      if (!prof?.id) {
        setStatus({
          type: "info",
          message: "That golfer hasn’t signed up yet. Ask them to create an account first.",
        });
        return;
      }

      const other = prof.id;
      const { user_low, user_high } = pairLowHigh(authId, other);

      const insRes = await withTimeout(
        supabase.from("friendships").insert({
          user_low,
          user_high,
          requester_id: authId,
          addressee_id: other,
          status: "pending",
        }),
        8000,
        "Create friend request"
      );

      if (insRes.error) {
        if (String(insRes.error.code) === "23505") {
          setStatus({
            type: "info",
            message: "You already have a request/friendship with this golfer.",
          });
          return;
        }
        throw insRes.error;
      }

      setEmail("");
      setStatus({ type: "success", message: "Friend request sent ✅" });
      await loadMeAndFriends();
    } catch (e) {
      setStatus({ type: "error", message: humanErr(e) });
    } finally {
      setActionLoading(false);
    }
  }

  async function acceptRequest(rowId) {
    if (!authId) return;
    setActionLoading(true);
    setStatus({ type: "", message: "" });

    try {
      const upRes = await withTimeout(
        supabase
          .from("friendships")
          .update({ status: "accepted" })
          .eq("id", rowId)
          .eq("addressee_id", authId),
        8000,
        "Accept request"
      );

      if (upRes.error) throw upRes.error;

      setStatus({ type: "success", message: "Friend added ✅" });
      await loadMeAndFriends();
    } catch (e) {
      setStatus({ type: "error", message: humanErr(e) });
    } finally {
      setActionLoading(false);
    }
  }

  async function removeFriendship(rowId) {
    if (!authId) return;
    setActionLoading(true);
    setStatus({ type: "", message: "" });

    try {
      const delRes = await withTimeout(
        supabase.from("friendships").delete().eq("id", rowId),
        8000,
        "Remove friendship"
      );

      if (delRes.error) throw delRes.error;

      setStatus({ type: "success", message: "Removed." });
      await loadMeAndFriends();
    } catch (e) {
      setStatus({ type: "error", message: humanErr(e) });
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Friends"
        subtitle="Add mates by email and keep banter in your circle."
        right={
          <button
            onClick={loadMeAndFriends}
            className="rounded-xl bg-white/10 px-4 py-2 text-sm hover:bg-white/15"
            disabled={actionLoading}
          >
            Refresh
          </button>
        }
      />

      <Card className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-extrabold text-white">Add a friend</div>
            <div className="mt-1 text-xs font-semibold text-slate-300">
              They must already have an account.
            </div>
          </div>

          {meProfile?.email ? (
            <span className="rounded-full bg-white/10 px-3 py-2 text-[11px] font-extrabold text-slate-200 ring-1 ring-white/10">
              You: {meProfile.email}
            </span>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <div className="text-xs font-extrabold uppercase tracking-wide text-slate-300">
              Email
            </div>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="mate@email.com"
              inputMode="email"
              disabled={actionLoading}
              className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-extrabold text-white outline-none ring-emerald-200 focus:ring-4"
            />
          </div>

          <button
            onClick={sendFriendRequest}
            disabled={actionLoading || !isValidEmail(email)}
            className={[
              "rounded-xl px-4 py-2 text-sm font-extrabold",
              actionLoading || !isValidEmail(email)
                ? "bg-white/10 text-slate-400 cursor-not-allowed"
                : "bg-emerald-600 text-white hover:bg-emerald-500",
            ].join(" ")}
          >
            {actionLoading ? "Sending…" : "Send request"}
          </button>
        </div>

        {status?.message ? (
          <div
            className={[
              "rounded-2xl px-4 py-3 text-sm font-semibold ring-1",
              status.type === "success"
                ? "bg-emerald-500/10 text-emerald-100 ring-emerald-500/20"
                : status.type === "info"
                ? "bg-white/5 text-slate-200 ring-white/10"
                : "bg-rose-500/10 text-rose-100 ring-rose-500/20",
            ].join(" ")}
          >
            {status.message}
          </div>
        ) : null}
      </Card>

      <Card className="p-5 space-y-3">
        <div className="text-sm font-extrabold text-white">Incoming requests</div>

        {loading ? (
          <div className="text-sm font-semibold text-slate-300">Loading…</div>
        ) : incoming.length === 0 ? (
          <div className="text-sm font-semibold text-slate-300">No incoming requests.</div>
        ) : (
          <div className="space-y-2">
            {incoming.map((r) => {
              const other = profilesById[otherId(r)] || null;
              return (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-extrabold text-white">
                      {shortName(other)}
                    </div>
                    <div className="truncate text-xs font-semibold text-slate-300">
                      {other?.email || "—"}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => acceptRequest(r.id)}
                      disabled={actionLoading}
                      className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-extrabold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => removeFriendship(r.id)}
                      disabled={actionLoading}
                      className="rounded-xl bg-white/10 px-3 py-2 text-xs font-extrabold text-slate-200 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                      title="Decline"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="p-5 space-y-3">
        <div className="text-sm font-extrabold text-white">Pending you sent</div>

        {loading ? (
          <div className="text-sm font-semibold text-slate-300">Loading…</div>
        ) : outgoing.length === 0 ? (
          <div className="text-sm font-semibold text-slate-300">No pending requests.</div>
        ) : (
          <div className="space-y-2">
            {outgoing.map((r) => {
              const other = profilesById[otherId(r)] || null;
              return (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-extrabold text-white">
                      {shortName(other)}
                    </div>
                    <div className="truncate text-xs font-semibold text-slate-300">
                      {other?.email || "—"}
                    </div>
                  </div>

                  <button
                    onClick={() => removeFriendship(r.id)}
                    disabled={actionLoading}
                    className="rounded-xl bg-white/10 px-3 py-2 text-xs font-extrabold text-slate-200 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                    title="Cancel request"
                  >
                    Cancel
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="p-5 space-y-3">
        <div className="text-sm font-extrabold text-white">Your friends</div>

        {loading ? (
          <div className="text-sm font-semibold text-slate-300">Loading…</div>
        ) : friends.length === 0 ? (
          <EmptyState
            icon="👥"
            title="No friends yet"
            description="Add your mates by email to start a proper league circle."
          />
        ) : (
          <div className="space-y-2">
            {friends.map((r) => {
              const other = profilesById[otherId(r)] || null;
              return (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-extrabold text-white">
                      {shortName(other)}
                    </div>
                    <div className="truncate text-xs font-semibold text-slate-300">
                      {other?.email || "—"}
                    </div>
                  </div>

                  <button
                    onClick={() => removeFriendship(r.id)}
                    disabled={actionLoading}
                    className="rounded-xl bg-rose-600 px-3 py-2 text-xs font-extrabold text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
                    title="Remove friend"
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}


