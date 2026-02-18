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

function shortId(id) {
  const s = String(id || "");
  if (!s) return "unknown";
  if (s.length <= 12) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function shortName(p) {
  return p?.display_name || p?.username || (p?.email ? p.email.split("@")[0] : null);
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

  // NOTE: your DB column is addresse_id (not addressee_id)
  const incoming = useMemo(() => {
    return friendships.filter((f) => f.status === "pending" && f.addresse_id === authId);
  }, [friendships, authId]);

  const outgoing = useMemo(() => {
    return friendships.filter((f) => f.status === "pending" && f.requester_id === authId);
  }, [friendships, authId]);

  const friends = useMemo(() => {
    // Only accepted rows involving me
    return friendships.filter(
      (f) => f.status === "accepted" && (f.user_low === authId || f.user_high === authId)
    );
  }, [friendships, authId]);

  // Canonical "other user" (use user_low/user_high, not requester/addressee direction)
  function otherId(row) {
    if (!row || !authId) return null;
    if (row.user_low === authId) return row.user_high;
    if (row.user_high === authId) return row.user_low;

    // Fallback (shouldn't happen if query filters correctly)
    if (row.requester_id === authId) return row.addresse_id;
    if (row.addresse_id === authId) return row.requester_id;
    return null;
  }

  function displayLineFromUserId(uid, prefix = "") {
    const p = profilesById[uid] || null;
    const name = shortName(p);
    const mail = p?.email ? String(p.email) : "";

    // Always render something useful even if profiles/email are blocked.
    if (name && mail) return `${prefix}${name} (${mail})`;
    if (name) return `${prefix}${name}`;
    return `${prefix}User ${shortId(uid)}`;
  }

  async function loadMeAndFriends() {
    setLoading(true);
    setStatus({ type: "", message: "" });

    try {
      const sessionRes = await withTimeout(supabase.auth.getSession(), 8000, "Auth session");

      const uid = sessionRes?.data?.session?.user?.id || null;
      setAuthId(uid);

      if (!uid) {
        setFriendships([]);
        setProfilesById({});
        setMeProfile(null);
        setStatus({ type: "error", message: "You’re not logged in." });
        return;
      }

      // Load my profile (email may be blocked by RLS — that's okay)
      const meRes = await withTimeout(
        supabase
          .from("profiles")
          .select("id,email,display_name,username,created_at")
          .eq("id", uid)
          .maybeSingle(),
        8000,
        "Load profile"
      );

      if (meRes.error) throw meRes.error;
      setMeProfile(meRes.data || null);

      // Load friendships involving me
      const frRes = await withTimeout(
        supabase
          .from("friendships")
          .select("id,user_low,user_high,requester_id,addresse_id,status,created_at,updated_at")
          // Use canonical pair columns for involvement (more reliable than requester/addressee)
          .or(`user_low.eq.${uid},user_high.eq.${uid}`)
          .order("updated_at", { ascending: false }),
        8000,
        "Load friendships"
      );

      if (frRes.error) throw frRes.error;

      const rows = ensureArr(frRes.data);
      setFriendships(rows);

      // Get all the "other user ids" we need profiles for
      const ids = Array.from(new Set(rows.map((r) => otherId(r)).filter(Boolean)));

      if (!ids.length) {
        setProfilesById({});
        return;
      }

      // Load friend profiles (email may be private; still fine)
      const profRes = await withTimeout(
        supabase.from("profiles").select("id,email,display_name,username,created_at").in("id", ids),
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

  async function copyMyEmail() {
    const myEmail = meProfile?.email || "";
    if (!myEmail) return;
    try {
      await navigator.clipboard.writeText(myEmail);
      setStatus({ type: "success", message: "Your email copied ✅ Send it to your mate." });
    } catch {
      setStatus({ type: "info", message: "Couldn’t copy automatically. Just type it to them." });
    }
  }

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
        supabase.from("profiles").select("id,email,display_name,username").eq("email", targetEmail).maybeSingle(),
        8000,
        "Find profile by email"
      );

      if (profRes.error) throw profRes.error;

      const prof = profRes.data;
      if (!prof?.id) {
        setStatus({
          type: "info",
          message: "That golfer hasn’t signed up yet. Tell them to create an account first.",
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
          addresse_id: other, // correct column name
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
          .eq("addresse_id", authId), // correct column name
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
      const delRes = await withTimeout(supabase.from("friendships").delete().eq("id", rowId), 8000, "Remove friendship");

      if (delRes.error) throw delRes.error;

      setStatus({ type: "success", message: "Removed." });
      await loadMeAndFriends();
    } catch (e) {
      setStatus({ type: "error", message: humanErr(e) });
    } finally {
      setActionLoading(false);
    }
  }

  const StatusBanner = status?.message ? (
    <div
      className={[
        "rounded-2xl px-4 py-3 text-sm font-semibold ring-1",
        status.type === "success"
          ? "bg-emerald-500/15 text-emerald-100 ring-emerald-500/30"
          : status.type === "info"
          ? "bg-white/10 text-slate-100 ring-white/15"
          : "bg-rose-500/15 text-rose-100 ring-rose-500/30",
      ].join(" ")}
    >
      {status.message}
    </div>
  ) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Friends"
        subtitle="Add mates by email, accept requests, and build your circle."
        right={
          <button
            onClick={loadMeAndFriends}
            className="rounded-xl bg-white/15 px-4 py-2 text-sm font-extrabold text-white hover:bg-white/20 disabled:opacity-60"
            disabled={actionLoading}
          >
            Refresh
          </button>
        }
      />

      {/* Add friend */}
      <Card className="p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-base font-extrabold text-white">Add a friend</div>
            <div className="mt-1 text-sm font-semibold text-slate-100">
              Type their email (they must already have an account).
            </div>
          </div>

          {meProfile?.email ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white/10 px-3 py-2 text-xs font-extrabold text-slate-100 ring-1 ring-white/15">
                You: {meProfile.email}
              </span>
              <button
                type="button"
                onClick={copyMyEmail}
                className="rounded-xl bg-white/15 px-3 py-2 text-xs font-extrabold text-white hover:bg-white/20"
              >
                Copy my email
              </button>
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <div className="text-xs font-extrabold uppercase tracking-wide text-slate-100">
              Friend’s email
            </div>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="mate@email.com"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={actionLoading}
              className="mt-2 w-full rounded-xl border border-white/15 bg-slate-950/40 px-3 py-2 text-sm font-extrabold text-white caret-white placeholder:text-slate-200 outline-none ring-emerald-200 focus:ring-4"
            />
          </div>

          <button
            onClick={sendFriendRequest}
            disabled={actionLoading || !isValidEmail(email)}
            className={[
              "rounded-xl px-4 py-2 text-sm font-extrabold",
              actionLoading || !isValidEmail(email)
                ? "bg-white/10 text-slate-200 cursor-not-allowed"
                : "bg-emerald-600 text-white hover:bg-emerald-500",
            ].join(" ")}
          >
            {actionLoading ? "Sending…" : "Send request"}
          </button>
        </div>

        {StatusBanner}
      </Card>

      {/* Incoming */}
      <Card className="p-5 space-y-3">
        <div className="text-base font-extrabold text-white">Incoming requests</div>

        {loading ? (
          <div className="text-sm font-semibold text-slate-100">Loading…</div>
        ) : incoming.length === 0 ? (
          <div className="text-sm font-semibold text-slate-100">No incoming requests.</div>
        ) : (
          <div className="space-y-2">
            {incoming.map((r) => {
              const fromId = r.requester_id;
              return (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-white/10 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-extrabold text-white">
                      {displayLineFromUserId(fromId, "From: ")}
                    </div>
                    <div className="truncate text-xs font-semibold text-slate-100">
                      Request • {new Date(r.created_at).toLocaleString()}
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
                      className="rounded-xl bg-white/15 px-3 py-2 text-xs font-extrabold text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
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

      {/* Outgoing */}
      <Card className="p-5 space-y-3">
        <div className="text-base font-extrabold text-white">Pending you sent</div>

        {loading ? (
          <div className="text-sm font-semibold text-slate-100">Loading…</div>
        ) : outgoing.length === 0 ? (
          <div className="text-sm font-semibold text-slate-100">No pending requests.</div>
        ) : (
          <div className="space-y-2">
            {outgoing.map((r) => {
              const toId = r.addresse_id;
              return (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-white/10 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-extrabold text-white">
                      {displayLineFromUserId(toId, "To: ")}
                    </div>
                    <div className="truncate text-xs font-semibold text-slate-100">
                      Pending • {new Date(r.created_at).toLocaleString()}
                    </div>
                  </div>

                  <button
                    onClick={() => removeFriendship(r.id)}
                    disabled={actionLoading}
                    className="rounded-xl bg-white/15 px-3 py-2 text-xs font-extrabold text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
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

      {/* Friends */}
      <Card className="p-5 space-y-3">
        <div className="text-base font-extrabold text-white">Your friends</div>

        {loading ? (
          <div className="text-sm font-semibold text-slate-100">Loading…</div>
        ) : friends.length === 0 ? (
          <EmptyState
            icon="👥"
            title="No friends yet"
            description="Add your mates by email so you can invite them into leagues."
          />
        ) : (
          <div className="space-y-2">
            {friends.map((r) => {
              const oid = otherId(r);
              return (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-white/10 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-extrabold text-white">
                      {displayLineFromUserId(oid)}
                    </div>
                    <div className="truncate text-xs font-semibold text-slate-100">
                      Friends • {new Date(r.created_at).toLocaleDateString()}
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

