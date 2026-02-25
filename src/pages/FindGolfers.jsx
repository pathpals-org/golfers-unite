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
  return p?.display_name || p?.username || (p?.email ? String(p.email).split("@")[0] : null);
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

  // ✅ Correct column name: addressee_id
  const incoming = useMemo(() => {
    return friendships.filter((f) => f.status === "pending" && f.addressee_id === authId);
  }, [friendships, authId]);

  const outgoing = useMemo(() => {
    return friendships.filter((f) => f.status === "pending" && f.requester_id === authId);
  }, [friendships, authId]);

  const friends = useMemo(() => {
    return friendships.filter(
      (f) =>
        f.status === "accepted" &&
        (f.user_low === authId || f.user_high === authId || f.requester_id === authId || f.addressee_id === authId)
    );
  }, [friendships, authId]);

  function otherId(row) {
    if (!row || !authId) return null;

    // Preferred: canonical pair columns
    if (row.user_low && row.user_high) {
      if (row.user_low === authId) return row.user_high;
      if (row.user_high === authId) return row.user_low;
    }

    // Fallback: directional columns
    if (row.requester_id && row.addressee_id) {
      if (row.requester_id === authId) return row.addressee_id;
      if (row.addressee_id === authId) return row.requester_id;
    }

    return null;
  }

  function displayLineFromUserId(uid, prefix = "") {
    const p = profilesById[uid] || null;
    const name = shortName(p);
    const mail = p?.email ? String(p.email) : "";

    if (name && mail) return `${prefix}${name} (${mail})`;
    if (name) return `${prefix}${name}`;
    return `${prefix}User ${shortId(uid)}`;
  }

  async function loadMeAndFriends() {
    setLoading(true);
    setStatus((s) => (s?.type === "success" ? s : { type: "", message: "" }));

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

      // Load my profile
      const meRes = await withTimeout(
        supabase.from("profiles").select("id,email,display_name,username,created_at").eq("id", uid).maybeSingle(),
        8000,
        "Load profile"
      );

      if (meRes.error) throw meRes.error;
      setMeProfile(meRes.data || null);

      // ✅ IMPORTANT: Load friendships involving me using BOTH pair + direction columns
      const frRes = await withTimeout(
        supabase
          .from("friendships")
          .select("id,user_low,user_high,requester_id,addressee_id,status,created_at,updated_at")
          .or(`user_low.eq.${uid},user_high.eq.${uid},requester_id.eq.${uid},addressee_id.eq.${uid}`)
          .order("updated_at", { ascending: false }),
        8000,
        "Load friendships"
      );

      if (frRes.error) throw frRes.error;

      const rows = ensureArr(frRes.data);
      setFriendships(rows);

      const ids = Array.from(new Set(rows.map((r) => otherId(r)).filter(Boolean)));

      if (!ids.length) {
        setProfilesById({});
        return;
      }

      const profRes = await withTimeout(
        supabase.from("profiles").select("id,email,display_name,username,created_at").in("id", ids),
        8000,
        "Load friend profiles"
      );

      // If profiles SELECT blocked by RLS, still show fallback IDs
      if (profRes.error) {
        setProfilesById({});
        return;
      }

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

  async function lookupExistingFriendship(myId, otherId) {
    const { user_low, user_high } = pairLowHigh(myId, otherId);

    // Try canonical pair lookup first
    const a = await supabase
      .from("friendships")
      .select("id,status,requester_id,addressee_id,created_at,updated_at")
      .eq("user_low", user_low)
      .eq("user_high", user_high)
      .maybeSingle();

    if (!a.error && a.data) return a.data;

    // Fallback: direction lookup
    const b = await supabase
      .from("friendships")
      .select("id,status,requester_id,addressee_id,created_at,updated_at")
      .or(
        `and(requester_id.eq.${myId},addressee_id.eq.${otherId}),and(requester_id.eq.${otherId},addressee_id.eq.${myId})`
      )
      .maybeSingle();

    if (!b.error && b.data) return b.data;

    return null;
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
      // Find profile by email (only works if profiles.email is readable under RLS)
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
          message:
            "Couldn’t find that email. Either they haven’t signed up yet, OR your profiles.email is private under RLS (so search-by-email won’t work).",
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
          // ✅ Explain what already exists
          const existing = await lookupExistingFriendship(authId, other);

          if (existing?.status === "accepted") {
            setStatus({ type: "info", message: "You’re already friends ✅ Scroll down — they’ll be in ‘Your friends’." });
          } else if (existing?.status === "pending") {
            if (existing.requester_id === authId) {
              setStatus({ type: "info", message: "You already sent a request to this golfer. See ‘Pending you sent’." });
            } else {
              setStatus({ type: "info", message: "They already sent you a request. See ‘Incoming requests’ and accept it." });
            }
          } else {
            setStatus({ type: "info", message: "A friendship/request already exists. Check the lists below." });
          }

          await loadMeAndFriends();
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
        supabase.from("friendships").update({ status: "accepted" }).eq("id", rowId).eq("addressee_id", authId),
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
          ? "bg-emerald-50 text-emerald-900 ring-emerald-200"
          : status.type === "info"
          ? "bg-slate-50 text-slate-800 ring-slate-200"
          : "bg-rose-50 text-rose-900 ring-rose-200",
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
            className="rounded-xl bg-white px-4 py-2 text-sm font-extrabold text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-60"
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
            <div className="text-base font-extrabold text-slate-900">Add a friend</div>
            <div className="mt-1 text-sm font-semibold text-slate-600">
              Type their email (they must already have an account).
            </div>
          </div>

          {meProfile?.email ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-slate-100 px-3 py-2 text-xs font-extrabold text-slate-800 ring-1 ring-slate-200">
                You: {meProfile.email}
              </span>
              <button
                type="button"
                onClick={copyMyEmail}
                className="rounded-xl bg-white px-3 py-2 text-xs font-extrabold text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50"
              >
                Copy my email
              </button>
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <div className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Friend’s email</div>
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
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-extrabold text-slate-900 caret-slate-900 placeholder:text-slate-400 outline-none ring-emerald-200 focus:ring-4"
            />
          </div>

          <button
            onClick={sendFriendRequest}
            disabled={actionLoading || !isValidEmail(email)}
            className={[
              "rounded-xl px-4 py-2 text-sm font-extrabold",
              actionLoading || !isValidEmail(email)
                ? "bg-slate-200 text-slate-500 cursor-not-allowed"
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
        <div className="text-base font-extrabold text-slate-900">Incoming requests</div>

        {loading ? (
          <div className="text-sm font-semibold text-slate-600">Loading…</div>
        ) : incoming.length === 0 ? (
          <div className="text-sm font-semibold text-slate-600">No incoming requests.</div>
        ) : (
          <div className="space-y-2">
            {incoming.map((r) => {
              const fromId = r.requester_id;
              return (
                <div key={r.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-extrabold text-slate-900">{displayLineFromUserId(fromId, "From: ")}</div>
                    <div className="truncate text-xs font-semibold text-slate-600">
                      Request • {r.created_at ? new Date(r.created_at).toLocaleString() : "—"}
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
                      className="rounded-xl bg-white px-3 py-2 text-xs font-extrabold text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
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
        <div className="text-base font-extrabold text-slate-900">Pending you sent</div>

        {loading ? (
          <div className="text-sm font-semibold text-slate-600">Loading…</div>
        ) : outgoing.length === 0 ? (
          <div className="text-sm font-semibold text-slate-600">No pending requests.</div>
        ) : (
          <div className="space-y-2">
            {outgoing.map((r) => {
              const toId = r.addressee_id;
              return (
                <div key={r.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-extrabold text-slate-900">{displayLineFromUserId(toId, "To: ")}</div>
                    <div className="truncate text-xs font-semibold text-slate-600">
                      Pending • {r.created_at ? new Date(r.created_at).toLocaleString() : "—"}
                    </div>
                  </div>

                  <button
                    onClick={() => removeFriendship(r.id)}
                    disabled={actionLoading}
                    className="rounded-xl bg-white px-3 py-2 text-xs font-extrabold text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
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
        <div className="text-base font-extrabold text-slate-900">Your friends</div>

        {loading ? (
          <div className="text-sm font-semibold text-slate-600">Loading…</div>
        ) : friends.length === 0 ? (
          <EmptyState icon="👥" title="No friends yet" description="Add your mates by email so you can invite them into leagues." />
        ) : (
          <div className="space-y-2">
            {friends.map((r) => {
              const oid = otherId(r);
              return (
                <div key={r.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-extrabold text-slate-900">{displayLineFromUserId(oid)}</div>
                    <div className="truncate text-xs font-semibold text-slate-600">
                      Friends • {r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}
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

