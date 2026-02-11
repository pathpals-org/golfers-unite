// src/pages/LeagueSettings.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Card from "../components/ui/Card";
import EmptyState from "../components/ui/EmptyState";
import PageHeader from "../components/ui/PageHeader";

import { supabase } from "../lib/supabaseClient";

import {
  getLeagueSafe,
  setLeagueSafe,
  setLeagueSeasonDates,
  getUsers,
  getPointsSystem,
  setPointsSystem,
  getLeagueRole,
  setLeagueRole,
  LEAGUE_ROLES,
} from "../utils/storage";

function ensureArr(v) {
  return Array.isArray(v) ? v : [];
}

function safeNum(n, fallback = 0) {
  const x = typeof n === "string" ? Number(n) : n;
  return Number.isFinite(x) ? x : fallback;
}

function toISODateInput(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function fromISODateInput(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  return d.toISOString();
}

function getUserId(u) {
  return u?.id || u?._id || null;
}

function getUserName(u) {
  return u?.name || u?.fullName || u?.displayName || u?.username || u?.display_name || "Golfer";
}

function normalizePlacement(v) {
  const raw = v && typeof v === "object" && !Array.isArray(v) ? v : {};
  const next = {};
  Object.keys(raw).forEach((k) => {
    const place = Math.trunc(Number(k));
    if (!Number.isFinite(place) || place <= 0) return;
    next[place] = Math.trunc(safeNum(raw[k], 0));
  });
  return next;
}

function placementRowsFromMap(map) {
  return Object.keys(normalizePlacement(map))
    .map((k) => Number(k))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
}

function roleLabel(role) {
  if (role === LEAGUE_ROLES.host) return "Host";
  if (role === LEAGUE_ROLES.co_host) return "Co-host";
  return "Member";
}

function humanizeSupabaseError(err) {
  const msg = err?.message || String(err || "");
  if (!msg) return "Something went wrong.";
  return msg;
}

function isUniqueViolation(err) {
  return String(err?.code || "") === "23505";
}

export default function LeagueSettings() {
  const navigate = useNavigate();
  const location = useLocation();

  const [league, setLeagueState] = useState(() => getLeagueSafe({}));
  const [users, setUsersState] = useState(() => ensureArr(getUsers([])));

  // ✅ Real auth user (Supabase)
  const [authUserId, setAuthUserId] = useState(null);

  // ✅ Live profile + role (Supabase truth)
  const [myProfile, setMyProfile] = useState(null);
  const [myRoleLive, setMyRoleLive] = useState(null);
  const [roleLoading, setRoleLoading] = useState(false);

  // 🔒 Freeze league id for the whole lifetime of this page instance
  const stableLeagueIdRef = useRef(null);

  // Prevent stale async responses overwriting newer ones
  const roleReqIdRef = useRef(0);

  // Invite status UI
  const [inviteStatus, setInviteStatus] = useState({ type: "", message: "" });

  // Friends for invite list (Supabase source of truth)
  const [friends, setFriends] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(false);

  // Pending invites UI
  const [pendingInvites, setPendingInvites] = useState([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [inviteActionId, setInviteActionId] = useState(null); // for per-row loading

  // points system
  const pointsSystem = useMemo(() => getPointsSystem(null), [league?.pointsSystem]);

  // points draft
  const [pointsDraft, setPointsDraft] = useState(() => {
    const ps = getPointsSystem(null);
    return {
      placementPoints: normalizePlacement(ps?.placementPoints || { 1: 3, 2: 2, 3: 0 }),

      participationEnabled: Boolean(ps?.participation?.enabled),
      participationPoints: safeNum(ps?.participation?.points, 1),

      bonusesEnabled: Boolean(ps?.bonuses?.enabled),
      birdieEnabled: Boolean(ps?.bonuses?.birdie?.enabled),
      birdiePoints: safeNum(ps?.bonuses?.birdie?.points, 1),
      eagleEnabled: Boolean(ps?.bonuses?.eagle?.enabled),
      eaglePoints: safeNum(ps?.bonuses?.eagle?.points, 2),
      hioEnabled: Boolean(ps?.bonuses?.hio?.enabled),
      hioPoints: safeNum(ps?.bonuses?.hio?.points, 5),
    };
  });

  // season dates draft
  const [seasonStart, setSeasonStart] = useState(() => toISODateInput(league?.seasonStartISO));
  const [seasonEnd, setSeasonEnd] = useState(() => toISODateInput(league?.seasonEndISO));

  const members = useMemo(() => ensureArr(league?.members), [league?.members]);

  const memberUsers = useMemo(() => {
    const setIds = new Set(members);
    return users.filter((u) => setIds.has(getUserId(u)));
  }, [users, members]);

  // ✅ Local fallback "me" (display only; NOT permissions)
  const me = useMemo(() => {
    if (authUserId) return users.find((u) => getUserId(u) === authUserId) || null;
    return users?.[0] || null;
  }, [authUserId, users]);

  const myId = authUserId || getUserId(me);
  const myDisplayName = myProfile?.display_name || getUserName(me);

  // ✅ Permissions ONLY from Supabase truth (league_members)
  const myRole = myRoleLive || LEAGUE_ROLES.member;
  const canEdit = myRoleLive === LEAGUE_ROLES.host || myRoleLive === LEAGUE_ROLES.co_host;

  // ✅ Bootstrap auth in a stable way (Netlify timing safe)
  useEffect(() => {
    let alive = true;

    async function boot() {
      try {
        const { data } = await supabase.auth.getSession();
        if (!alive) return;
        setAuthUserId(data?.session?.user?.id || null);
      } catch {
        if (!alive) return;
        setAuthUserId(null);
      }
    }

    boot();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!alive) return;
      setAuthUserId(session?.user?.id || null);
    });

    return () => {
      alive = false;
      try {
        sub?.subscription?.unsubscribe?.();
      } catch {
        // ignore
      }
    };
  }, []);

  // ✅ One-time page init: read cached league ONCE, freeze leagueId ONCE
  useEffect(() => {
    const l = getLeagueSafe({});
    const u = ensureArr(getUsers([]));

    // Freeze league id only the first time we see it.
    // This is the key: the id cannot "jump" later due to cache resync.
    if (!stableLeagueIdRef.current && l?.id) {
      stableLeagueIdRef.current = l.id;
    }

    // Keep displaying whatever we have cached for UI/offline
    setLeagueState(l);
    setUsersState(u);

    setSeasonStart(toISODateInput(l?.seasonStartISO));
    setSeasonEnd(toISODateInput(l?.seasonEndISO));

    const ps = getPointsSystem(null);
    setPointsDraft({
      placementPoints: normalizePlacement(ps?.placementPoints || { 1: 3, 2: 2, 3: 0 }),

      participationEnabled: Boolean(ps?.participation?.enabled),
      participationPoints: safeNum(ps?.participation?.points, 1),

      bonusesEnabled: Boolean(ps?.bonuses?.enabled),
      birdieEnabled: Boolean(ps?.bonuses?.birdie?.enabled),
      birdiePoints: safeNum(ps?.bonuses?.birdie?.points, 1),
      eagleEnabled: Boolean(ps?.bonuses?.eagle?.enabled),
      eaglePoints: safeNum(ps?.bonuses?.eagle?.points, 2),
      hioEnabled: Boolean(ps?.bonuses?.hio?.enabled),
      hioPoints: safeNum(ps?.bonuses?.hio?.points, 5),
    });

    // Clean UI state on entry
    setInviteStatus({ type: "", message: "" });
    setPendingInvites([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshMyProfileAndRole() {
    const leagueId = stableLeagueIdRef.current;
    if (!authUserId || !leagueId) return;

    const reqId = ++roleReqIdRef.current;
    setRoleLoading(true);

    try {
      // Profile
      const { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select("id, display_name")
        .eq("id", authUserId)
        .single();

      if (reqId !== roleReqIdRef.current) return;
      if (profErr) throw profErr;
      setMyProfile(prof || null);

      // Role (truth)
      const { data: mem, error: memErr } = await supabase
        .from("league_members")
        .select("role")
        .eq("league_id", leagueId)
        .eq("user_id", authUserId)
        .maybeSingle();

      if (reqId !== roleReqIdRef.current) return;
      if (memErr) throw memErr;

      const role = mem?.role || LEAGUE_ROLES.member;
      setMyRoleLive(role);

      // Optional cache alignment (NOT permission-bearing)
      try {
        setLeagueRole(authUserId, role);
      } catch {
        // ignore
      }
    } catch {
      // Apple-ready: do NOT overwrite a known-good role with null/member because of a transient failure
      if (reqId !== roleReqIdRef.current) return;
      if (myRoleLive == null) {
        setMyRoleLive(null); // default view-only when unknown
      }
    } finally {
      if (reqId !== roleReqIdRef.current) return;
      setRoleLoading(false);
    }
  }

  // ✅ Refresh when auth user changes (NOT when canEdit changes)
  useEffect(() => {
    refreshMyProfileAndRole();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUserId]);

  async function loadPendingInvites({ leagueId }) {
    if (!leagueId) return;

    setInvitesLoading(true);
    try {
      const { data, error } = await supabase
        .from("league_invites")
        .select(
          `
          id,
          league_id,
          inviter_user_id,
          invitee_user_id,
          status,
          created_at,
          invitee:profiles!league_invites_invitee_user_id_fkey (
            id,
            display_name
          )
        `
        )
        .eq("league_id", leagueId)
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setPendingInvites(ensureArr(data));
    } catch {
      setPendingInvites([]);
    } finally {
      setInvitesLoading(false);
    }
  }

  async function loadFriendsForInvites({ userId }) {
    if (!userId) {
      setFriends([]);
      return;
    }

    setFriendsLoading(true);
    try {
      const { data: rows, error } = await supabase
        .from("friendships")
        .select("id,user_low,user_high,status")
        .eq("status", "accepted")
        .or(`user_low.eq.${userId},user_high.eq.${userId}`);

      if (error) throw error;

      const rels = ensureArr(rows);
      const friendIds = rels
        .map((r) => {
          const low = r?.user_low || null;
          const high = r?.user_high || null;
          if (!low || !high) return null;
          return low === userId ? high : low;
        })
        .filter(Boolean);

      const uniq = Array.from(new Set(friendIds));

      if (uniq.length === 0) {
        setFriends([]);
        return;
      }

      const { data: profs, error: profErr } = await supabase
        .from("profiles")
        .select("id,display_name")
        .in("id", uniq);

      if (profErr) throw profErr;

      const next = ensureArr(profs).sort((a, b) => {
        const an = String(a?.display_name || "").toLowerCase();
        const bn = String(b?.display_name || "").toLowerCase();
        return an.localeCompare(bn);
      });

      setFriends(next);
    } catch (e) {
      setFriends([]);
      setInviteStatus({ type: "error", message: humanizeSupabaseError(e) });
    } finally {
      setFriendsLoading(false);
    }
  }

  // load friends when we have a user id (auth preferred)
  useEffect(() => {
    if (!myId) return;
    loadFriendsForInvites({ userId: myId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId]);

  // ✅ Load pending invites ONLY when edit is enabled (and stable leagueId is frozen)
  useEffect(() => {
    const leagueId = stableLeagueIdRef.current;
    if (!leagueId) return;

    if (!canEdit) {
      setPendingInvites([]);
      return;
    }
    loadPendingInvites({ leagueId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit]);

  if (!league?.id) {
    return (
      <div className="pt-2">
        <EmptyState
          icon="⚙️"
          title="No league found"
          description="Create or seed a league first, then you can edit league settings here."
          actions={
            <button
              onClick={() => navigate("/leagues")}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-extrabold text-white"
            >
              Back to League
            </button>
          }
        />
      </div>
    );
  }

  function setPreset(preset) {
    if (!canEdit) return;

    if (preset === "default") {
      setPointsDraft((d) => ({
        ...d,
        placementPoints: normalizePlacement({ 1: 3, 2: 2, 3: 0 }),
      }));
      return;
    }
    if (preset === "yourLeague") {
      setPointsDraft((d) => ({
        ...d,
        placementPoints: normalizePlacement({ 1: 3, 2: 1, 3: 0 }),
      }));
      return;
    }
    if (preset === "winnerOnly") {
      setPointsDraft((d) => ({
        ...d,
        placementPoints: normalizePlacement({ 1: 3 }),
      }));
      return;
    }
  }

  function updatePlacement(place, value) {
    if (!canEdit) return;
    const p = Math.trunc(safeNum(place, NaN));
    if (!Number.isFinite(p) || p <= 0) return;
    const v = Math.trunc(safeNum(value, 0));
    setPointsDraft((d) => ({
      ...d,
      placementPoints: { ...(d.placementPoints || {}), [p]: v },
    }));
  }

  function removePlacement(place) {
    if (!canEdit) return;
    const p = Math.trunc(safeNum(place, NaN));
    if (!Number.isFinite(p) || p <= 0) return;
    setPointsDraft((d) => {
      const next = { ...(d.placementPoints || {}) };
      delete next[p];
      return { ...d, placementPoints: next };
    });
  }

  function addPlacementRow() {
    if (!canEdit) return;
    setPointsDraft((d) => {
      const cur = normalizePlacement(d.placementPoints);
      const existingPlaces = Object.keys(cur).map((k) => Number(k));
      const nextPlace = existingPlaces.length ? Math.max(...existingPlaces) + 1 : 4;
      return { ...d, placementPoints: { ...cur, [nextPlace]: 0 } };
    });
  }

  function savePointsSystem() {
    if (!canEdit) return;

    const placementPoints = normalizePlacement(pointsDraft.placementPoints);
    const safePlacement =
      Object.keys(placementPoints).length > 0 ? placementPoints : { 1: 3, 2: 2, 3: 0 };

    const merged = {
      placementPoints: safePlacement,
      participation: {
        enabled: Boolean(pointsDraft.participationEnabled),
        points: Math.trunc(safeNum(pointsDraft.participationPoints, 1)),
      },
      bonuses: {
        enabled: Boolean(pointsDraft.bonusesEnabled),
        birdie: {
          enabled: Boolean(pointsDraft.birdieEnabled),
          points: Math.trunc(safeNum(pointsDraft.birdiePoints, 1)),
        },
        eagle: {
          enabled: Boolean(pointsDraft.eagleEnabled),
          points: Math.trunc(safeNum(pointsDraft.eaglePoints, 2)),
        },
        hio: {
          enabled: Boolean(pointsDraft.hioEnabled),
          points: Math.trunc(safeNum(pointsDraft.hioPoints, 5)),
        },
      },
    };

    const next = setPointsSystem(merged);
    const nextLeague = { ...getLeagueSafe({}), pointsSystem: next };
    setLeagueSafe(nextLeague);
    setLeagueState(nextLeague);
  }

  function saveSeasonDates() {
    if (!canEdit) return;

    const startISO = fromISODateInput(seasonStart) || league?.seasonStartISO;
    const endISO = seasonEnd ? fromISODateInput(seasonEnd) : null;

    const next = setLeagueSeasonDates({ startISO, endISO });
    setLeagueState(next);
  }

  function toggleCoHost(userId, makeCoHost) {
    if (!canEdit) return;
    if (!userId) return;

    setLeagueRole(userId, makeCoHost ? LEAGUE_ROLES.co_host : LEAGUE_ROLES.member);
    setLeagueState(getLeagueSafe({}));
  }

  async function sendInviteToFriend(friendProfile) {
    if (!canEdit) return;
    if (!league?.id) return;
    if (!myId) {
      setInviteStatus({ type: "error", message: "You must be signed in to invite." });
      return;
    }

    const inviteeUserId = friendProfile?.id || null;
    if (!inviteeUserId) return;

    // Already a member? (local hint; Supabase enforces truth)
    const memberSetLocal = new Set(ensureArr(members));
    if (memberSetLocal.has(inviteeUserId)) {
      setInviteStatus({ type: "info", message: "They’re already in this league." });
      return;
    }

    setInviteActionId(inviteeUserId);
    setInviteStatus({ type: "", message: "" });

    try {
      const { error: invErr } = await supabase.from("league_invites").insert({
        league_id: league.id,
        inviter_user_id: myId,
        invitee_user_id: inviteeUserId,
        status: "pending",
      });

      if (invErr) {
        if (isUniqueViolation(invErr)) {
          setInviteStatus({ type: "info", message: "Invite already pending for that golfer." });
          return;
        }
        throw invErr;
      }

      await loadPendingInvites({ leagueId: stableLeagueIdRef.current || league.id });

      setInviteStatus({
        type: "success",
        message: "Invite sent ✅ They’ll see it in their invites and can accept to join.",
      });
    } catch (e) {
      setInviteStatus({ type: "error", message: humanizeSupabaseError(e) });
    } finally {
      setInviteActionId(null);
    }
  }

  async function cancelInvite(inviteId) {
    if (!canEdit) return;
    if (!inviteId) return;

    try {
      const { error } = await supabase.from("league_invites").delete().eq("id", inviteId);
      if (error) throw error;

      await loadPendingInvites({ leagueId: stableLeagueIdRef.current || league.id });
      setInviteStatus({ type: "info", message: "Invite cancelled." });
    } catch (e) {
      setInviteStatus({ type: "error", message: humanizeSupabaseError(e) });
    }
  }

  const placementRows = placementRowsFromMap(pointsDraft.placementPoints);

  const memberSet = useMemo(() => new Set(ensureArr(members)), [members]);
  const pendingInviteeSet = useMemo(
    () => new Set(ensureArr(pendingInvites).map((x) => x?.invitee_user_id).filter(Boolean)),
    [pendingInvites]
  );

  const friendsNotInLeague = useMemo(() => {
    return ensureArr(friends).filter((p) => {
      const id = p?.id;
      if (!id) return false;
      if (memberSet.has(id)) return false;
      return true;
    });
  }, [friends, memberSet]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="League Settings"
        subtitle={
          canEdit ? "Manage points, season, and admins." : "You can view settings. Only host/co-host can edit."
        }
        right={
          <button
            type="button"
            onClick={() => navigate("/leagues")}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-extrabold text-white hover:bg-slate-800"
          >
            Back
          </button>
        }
      />

      {/* Admin status */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-extrabold text-slate-900">Your access</div>
            <div className="mt-1 text-xs font-semibold text-slate-600">
              Logged in as <span className="font-extrabold">{myDisplayName}</span> ·{" "}
              <span className="font-extrabold">{roleLabel(myRole)}</span>
              {roleLoading ? <span className="ml-2 text-slate-400">(checking…)</span> : null}
            </div>

            <button
              type="button"
              onClick={refreshMyProfileAndRole}
              disabled={!authUserId || roleLoading}
              className={[
                "mt-3 rounded-xl px-3 py-2 text-xs font-extrabold ring-1",
                !authUserId || roleLoading
                  ? "bg-slate-50 text-slate-400 ring-slate-200 cursor-not-allowed"
                  : "bg-white text-slate-900 ring-slate-200 hover:bg-slate-50",
              ].join(" ")}
            >
              {roleLoading ? "Refreshing…" : "Refresh permissions"}
            </button>
          </div>

          <span
            className={[
              "rounded-full px-3 py-2 text-xs font-extrabold ring-1",
              canEdit ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-slate-50 text-slate-700 ring-slate-200",
            ].join(" ")}
          >
            {canEdit ? "Editing enabled" : "View only"}
          </span>
        </div>
      </Card>

      {/* ✅ Invite to league */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-extrabold text-slate-900">Invite friends</div>
            <div className="mt-1 text-xs font-semibold text-slate-600">
              Host/co-host can invite accepted friends. They join only after they accept.
            </div>
          </div>

          <span className="rounded-full bg-slate-100 px-3 py-2 text-xs font-extrabold text-slate-700 ring-1 ring-slate-200">
            League ID: <span className="font-mono">{String(league.id).slice(0, 8)}…</span>
          </span>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
              Friends not in this league
            </div>

            <button
              type="button"
              disabled={!canEdit || friendsLoading}
              onClick={() => loadFriendsForInvites({ userId: myId })}
              className={[
                "rounded-xl px-3 py-2 text-xs font-extrabold ring-1",
                !canEdit || friendsLoading
                  ? "bg-slate-50 text-slate-400 ring-slate-200 cursor-not-allowed"
                  : "bg-white text-slate-900 ring-slate-200 hover:bg-slate-50",
              ].join(" ")}
            >
              {friendsLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          <div className="mt-2 space-y-2">
            {!canEdit ? (
              <div className="text-sm font-semibold text-slate-600">
                Only host/co-host can invite friends to the league.
              </div>
            ) : friendsLoading ? (
              <div className="text-sm font-semibold text-slate-600">Loading friends…</div>
            ) : friendsNotInLeague.length === 0 ? (
              <div className="text-sm font-semibold text-slate-600">
                No inviteable friends found (either none accepted yet, or they’re already in the league).
              </div>
            ) : (
              friendsNotInLeague.map((p) => {
                const pid = p?.id;
                const name = p?.display_name || "Friend";
                const alreadyInvited = pendingInviteeSet.has(pid);
                const busy = inviteActionId === pid;

                return (
                  <div
                    key={pid}
                    className="flex items-center justify-between gap-3 rounded-2xl bg-white p-3 ring-1 ring-slate-200"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-extrabold text-slate-900">{name}</div>
                    </div>

                    {alreadyInvited ? (
                      <span className="rounded-full bg-slate-100 px-3 py-2 text-xs font-extrabold text-slate-700 ring-1 ring-slate-200">
                        Invited
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => sendInviteToFriend(p)}
                        className={[
                          "rounded-xl px-3 py-2 text-xs font-extrabold",
                          busy ? "bg-slate-200 text-slate-500 cursor-not-allowed" : "bg-slate-900 text-white hover:bg-slate-800",
                        ].join(" ")}
                      >
                        {busy ? "Inviting…" : "Invite"}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Pending invites list */}
        <div className="mt-6">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
              Pending invites
            </div>

            <button
              type="button"
              disabled={!canEdit || invitesLoading}
              onClick={() => loadPendingInvites({ leagueId: stableLeagueIdRef.current || league.id })}
              className={[
                "rounded-xl px-3 py-2 text-xs font-extrabold ring-1",
                !canEdit || invitesLoading
                  ? "bg-slate-50 text-slate-400 ring-slate-200 cursor-not-allowed"
                  : "bg-white text-slate-900 ring-slate-200 hover:bg-slate-50",
              ].join(" ")}
            >
              {invitesLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          <div className="mt-2 space-y-2">
            {!canEdit ? (
              <div className="text-sm font-semibold text-slate-600">
                Only host/co-host can view and manage league invites.
              </div>
            ) : invitesLoading ? (
              <div className="text-sm font-semibold text-slate-600">Loading invites…</div>
            ) : pendingInvites.length === 0 ? (
              <div className="text-sm font-semibold text-slate-600">No pending invites.</div>
            ) : (
              pendingInvites.map((inv) => {
                const invitee = inv?.invitee || null;
                const display =
                  invitee?.display_name ||
                  String(inv?.invitee_user_id || "").slice(0, 8) + "…";

                const created = inv?.created_at ? new Date(inv.created_at) : null;

                return (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between gap-3 rounded-2xl bg-white p-3 ring-1 ring-slate-200"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-extrabold text-slate-900">{display}</div>
                      <div className="mt-0.5 text-xs font-semibold text-slate-600">
                        Status: <span className="font-extrabold">Pending</span>
                        {created ? (
                          <>
                            {" "}
                            · Sent {created.toLocaleDateString()}{" "}
                            {created.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </>
                        ) : null}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => cancelInvite(inv.id)}
                      className="rounded-xl bg-rose-600 px-3 py-2 text-xs font-extrabold text-white hover:bg-rose-500"
                      title="Cancel invite"
                    >
                      Cancel
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {inviteStatus?.message ? (
          <div
            className={[
              "mt-4 rounded-2xl px-4 py-3 text-sm font-semibold ring-1",
              inviteStatus.type === "success"
                ? "bg-emerald-50 text-emerald-900 ring-emerald-200"
                : inviteStatus.type === "info"
                ? "bg-slate-50 text-slate-800 ring-slate-200"
                : "bg-rose-50 text-rose-900 ring-rose-200",
            ].join(" ")}
          >
            {inviteStatus.message}
          </div>
        ) : null}
      </Card>

      {/* Points System */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-extrabold text-slate-900">Points system</div>
            <div className="mt-1 text-xs font-semibold text-slate-600">
              Configure how points are awarded in this league.
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => setPreset("default")}
              className={[
                "rounded-xl px-3 py-2 text-xs font-extrabold ring-1",
                canEdit
                  ? "bg-white text-slate-900 ring-slate-200 hover:bg-slate-50"
                  : "bg-slate-50 text-slate-400 ring-slate-200 cursor-not-allowed",
              ].join(" ")}
              title="1st=3, 2nd=2, 3rd=0"
            >
              Default (3/2/0)
            </button>

            <button
              type="button"
              disabled={!canEdit}
              onClick={() => setPreset("yourLeague")}
              className={[
                "rounded-xl px-3 py-2 text-xs font-extrabold ring-1",
                canEdit
                  ? "bg-white text-slate-900 ring-slate-200 hover:bg-slate-50"
                  : "bg-slate-50 text-slate-400 ring-slate-200 cursor-not-allowed",
              ].join(" ")}
              title="1st=3, 2nd=1, 3rd=0"
            >
              Your League (3/1/0)
            </button>

            <button
              type="button"
              disabled={!canEdit}
              onClick={() => setPreset("winnerOnly")}
              className={[
                "rounded-xl px-3 py-2 text-xs font-extrabold ring-1",
                canEdit
                  ? "bg-white text-slate-900 ring-slate-200 hover:bg-slate-50"
                  : "bg-slate-50 text-slate-400 ring-slate-200 cursor-not-allowed",
              ].join(" ")}
              title="Winner only"
            >
              Winner only
            </button>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          {/* Placement points */}
          <div>
            <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
              Placement points
            </div>

            <div className="mt-2 overflow-hidden rounded-2xl border border-slate-200">
              <div className="grid grid-cols-[70px_1fr_54px] items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                <div>Place</div>
                <div>Points</div>
                <div className="text-right">Del</div>
              </div>

              <div className="divide-y divide-slate-200 bg-white">
                {placementRows.length === 0 ? (
                  <div className="px-4 py-3 text-sm font-semibold text-slate-600">
                    No placement rules set yet.
                  </div>
                ) : (
                  placementRows.map((p) => (
                    <div
                      key={p}
                      className="grid grid-cols-[70px_1fr_54px] items-center gap-2 px-4 py-2"
                    >
                      <div className="text-sm font-extrabold text-slate-900">
                        {p}
                        {p === 1 ? "st" : p === 2 ? "nd" : p === 3 ? "rd" : "th"}
                      </div>

                      <input
                        value={String(pointsDraft.placementPoints?.[p] ?? 0)}
                        onChange={(e) => updatePlacement(p, e.target.value)}
                        inputMode="numeric"
                        disabled={!canEdit}
                        className={[
                          "w-full rounded-xl border px-3 py-2 text-sm font-extrabold outline-none ring-emerald-200 focus:ring-4",
                          canEdit
                            ? "border-slate-200 bg-white text-slate-900"
                            : "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed",
                        ].join(" ")}
                        aria-label={`Points for place ${p}`}
                      />

                      <div className="text-right">
                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={() => removePlacement(p)}
                          className={[
                            "rounded-xl px-3 py-2 text-xs font-extrabold",
                            canEdit
                              ? "bg-rose-600 text-white hover:bg-rose-500"
                              : "bg-slate-100 text-slate-400 cursor-not-allowed",
                          ].join(" ")}
                          title="Remove this place"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="border-t border-slate-200 bg-white px-4 py-3">
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={addPlacementRow}
                  className={[
                    "rounded-xl px-4 py-2 text-xs font-extrabold",
                    canEdit
                      ? "bg-slate-100 text-slate-900 hover:bg-slate-200"
                      : "bg-slate-50 text-slate-400 cursor-not-allowed",
                  ].join(" ")}
                >
                  + Add place
                </button>
              </div>
            </div>

            <div className="mt-2 text-xs font-semibold text-slate-500">
              Anyone outside these places gets <span className="font-extrabold">0</span> points.
            </div>
          </div>

          {/* Participation */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-extrabold text-slate-900">Participation point</div>
                <div className="mt-1 text-xs font-semibold text-slate-600">
                  Optional point just for playing.
                </div>
              </div>

              <button
                type="button"
                disabled={!canEdit}
                onClick={() =>
                  setPointsDraft((d) => ({ ...d, participationEnabled: !d.participationEnabled }))
                }
                className={[
                  "rounded-xl px-4 py-2 text-xs font-extrabold ring-1",
                  !canEdit
                    ? "bg-slate-50 text-slate-400 ring-slate-200 cursor-not-allowed"
                    : pointsDraft.participationEnabled
                    ? "bg-emerald-600 text-white ring-emerald-600 hover:bg-emerald-500"
                    : "bg-slate-100 text-slate-900 ring-slate-200 hover:bg-slate-200",
                ].join(" ")}
              >
                {pointsDraft.participationEnabled ? "On" : "Off"}
              </button>
            </div>

            {pointsDraft.participationEnabled ? (
              <div className="mt-3 grid grid-cols-[1fr_120px] items-center gap-2">
                <div className="text-xs font-semibold text-slate-600">Points awarded</div>
                <input
                  value={String(pointsDraft.participationPoints)}
                  onChange={(e) =>
                    setPointsDraft((d) => ({ ...d, participationPoints: e.target.value }))
                  }
                  inputMode="numeric"
                  disabled={!canEdit}
                  className={[
                    "w-full rounded-xl border px-3 py-2 text-sm font-extrabold outline-none ring-emerald-200 focus:ring-4",
                    canEdit
                      ? "border-slate-200 bg-white text-slate-900"
                      : "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed",
                  ].join(" ")}
                />
              </div>
            ) : null}
          </div>

          {/* Bonuses */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-extrabold text-slate-900">Bonus points</div>
                <div className="mt-1 text-xs font-semibold text-slate-600">
                  Simple toggles for MVP (no auto counting yet).
                </div>
              </div>

              <button
                type="button"
                disabled={!canEdit}
                onClick={() => setPointsDraft((d) => ({ ...d, bonusesEnabled: !d.bonusesEnabled }))}
                className={[
                  "rounded-xl px-4 py-2 text-xs font-extrabold ring-1",
                  !canEdit
                    ? "bg-slate-50 text-slate-400 ring-slate-200 cursor-not-allowed"
                    : pointsDraft.bonusesEnabled
                    ? "bg-emerald-600 text-white ring-emerald-600 hover:bg-emerald-500"
                    : "bg-slate-100 text-slate-900 ring-slate-200 hover:bg-slate-200",
                ].join(" ")}
              >
                {pointsDraft.bonusesEnabled ? "On" : "Off"}
              </button>
            </div>

            {pointsDraft.bonusesEnabled ? (
              <div className="mt-4 space-y-3">
                {/* Birdie */}
                <div className="grid grid-cols-[1fr_70px_120px] items-center gap-2">
                  <div className="text-sm font-extrabold text-slate-900">Birdie</div>
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => setPointsDraft((d) => ({ ...d, birdieEnabled: !d.birdieEnabled }))}
                    className={[
                      "rounded-xl px-3 py-2 text-xs font-extrabold ring-1",
                      !canEdit
                        ? "bg-slate-50 text-slate-400 ring-slate-200 cursor-not-allowed"
                        : pointsDraft.birdieEnabled
                        ? "bg-emerald-600 text-white ring-emerald-600 hover:bg-emerald-500"
                        : "bg-slate-100 text-slate-900 ring-slate-200 hover:bg-slate-200",
                    ].join(" ")}
                  >
                    {pointsDraft.birdieEnabled ? "On" : "Off"}
                  </button>
                  <input
                    value={String(pointsDraft.birdiePoints)}
                    onChange={(e) => setPointsDraft((d) => ({ ...d, birdiePoints: e.target.value }))}
                    inputMode="numeric"
                    disabled={!canEdit || !pointsDraft.birdieEnabled}
                    className={[
                      "w-full rounded-xl border px-3 py-2 text-sm font-extrabold outline-none ring-emerald-200 focus:ring-4",
                      !canEdit || !pointsDraft.birdieEnabled
                        ? "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed"
                        : "border-slate-200 bg-white text-slate-900",
                    ].join(" ")}
                  />
                </div>

                {/* Eagle */}
                <div className="grid grid-cols-[1fr_70px_120px] items-center gap-2">
                  <div className="text-sm font-extrabold text-slate-900">Eagle</div>
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => setPointsDraft((d) => ({ ...d, eagleEnabled: !d.eagleEnabled }))}
                    className={[
                      "rounded-xl px-3 py-2 text-xs font-extrabold ring-1",
                      !canEdit
                        ? "bg-slate-50 text-slate-400 ring-slate-200 cursor-not-allowed"
                        : pointsDraft.eagleEnabled
                        ? "bg-emerald-600 text-white ring-emerald-600 hover:bg-emerald-500"
                        : "bg-slate-100 text-slate-900 ring-slate-200 hover:bg-slate-200",
                    ].join(" ")}
                  >
                    {pointsDraft.eagleEnabled ? "On" : "Off"}
                  </button>
                  <input
                    value={String(pointsDraft.eaglePoints)}
                    onChange={(e) => setPointsDraft((d) => ({ ...d, eaglePoints: e.target.value }))}
                    inputMode="numeric"
                    disabled={!canEdit || !pointsDraft.eagleEnabled}
                    className={[
                      "w-full rounded-xl border px-3 py-2 text-sm font-extrabold outline-none ring-emerald-200 focus:ring-4",
                      !canEdit || !pointsDraft.eagleEnabled
                        ? "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed"
                        : "border-slate-200 bg-white text-slate-900",
                    ].join(" ")}
                  />
                </div>

                {/* HIO */}
                <div className="grid grid-cols-[1fr_70px_120px] items-center gap-2">
                  <div className="text-sm font-extrabold text-slate-900">Hole in one</div>
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => setPointsDraft((d) => ({ ...d, hioEnabled: !d.hioEnabled }))}
                    className={[
                      "rounded-xl px-3 py-2 text-xs font-extrabold ring-1",
                      !canEdit
                        ? "bg-slate-50 text-slate-400 ring-slate-200 cursor-not-allowed"
                        : pointsDraft.hioEnabled
                        ? "bg-emerald-600 text-white ring-emerald-600 hover:bg-emerald-500"
                        : "bg-slate-100 text-slate-900 ring-slate-200 hover:bg-slate-200",
                    ].join(" ")}
                  >
                    {pointsDraft.hioEnabled ? "On" : "Off"}
                  </button>
                  <input
                    value={String(pointsDraft.hioPoints)}
                    onChange={(e) => setPointsDraft((d) => ({ ...d, hioPoints: e.target.value }))}
                    inputMode="numeric"
                    disabled={!canEdit || !pointsDraft.hioEnabled}
                    className={[
                      "w-full rounded-xl border px-3 py-2 text-sm font-extrabold outline-none ring-emerald-200 focus:ring-4",
                      !canEdit || !pointsDraft.hioEnabled
                        ? "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed"
                        : "border-slate-200 bg-white text-slate-900",
                    ].join(" ")}
                  />
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!canEdit}
              onClick={savePointsSystem}
              className={[
                "rounded-xl px-4 py-2 text-sm font-extrabold",
                canEdit
                  ? "bg-slate-900 text-white hover:bg-slate-800"
                  : "bg-slate-200 text-slate-500 cursor-not-allowed",
              ].join(" ")}
            >
              Save points system
            </button>

            <button
              type="button"
              onClick={() => navigate("/leagues")}
              className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-extrabold text-slate-900 hover:bg-slate-200"
            >
              Done
            </button>
          </div>
        </div>
      </Card>

      {/* Season dates */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-extrabold text-slate-900">Season dates</div>
            <div className="mt-1 text-xs font-semibold text-slate-600">
              Used for standings, trophies, and archiving. Example: April → April.
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
              Season start
            </div>
            <input
              type="date"
              value={seasonStart}
              onChange={(e) => setSeasonStart(e.target.value)}
              disabled={!canEdit}
              className={[
                "mt-2 w-full rounded-xl border px-3 py-2 text-sm font-extrabold outline-none ring-emerald-200 focus:ring-4",
                canEdit
                  ? "border-slate-200 bg-white text-slate-900"
                  : "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed",
              ].join(" ")}
            />
          </div>

          <div>
            <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
              Season end (optional)
            </div>
            <input
              type="date"
              value={seasonEnd}
              onChange={(e) => setSeasonEnd(e.target.value)}
              disabled={!canEdit}
              className={[
                "mt-2 w-full rounded-xl border px-3 py-2 text-sm font-extrabold outline-none ring-emerald-200 focus:ring-4",
                canEdit
                  ? "border-slate-200 bg-white text-slate-900"
                  : "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed",
              ].join(" ")}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!canEdit}
            onClick={saveSeasonDates}
            className={[
              "rounded-xl px-4 py-2 text-sm font-extrabold",
              canEdit ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-slate-200 text-slate-500 cursor-not-allowed",
            ].join(" ")}
          >
            Save season dates
          </button>
        </div>
      </Card>

      {/* Admins */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-extrabold text-slate-900">Admins</div>
            <div className="mt-1 text-xs font-semibold text-slate-600">
              Host and co-hosts can manage points and league settings.
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {memberUsers.length === 0 ? (
            <div className="text-sm font-semibold text-slate-600">No members found.</div>
          ) : (
            memberUsers.map((u) => {
              const uid = getUserId(u);
              const role = getLeagueRole(uid);
              const isHost = role === LEAGUE_ROLES.host;
              const isCoHost = role === LEAGUE_ROLES.co_host;

              return (
                <div
                  key={uid}
                  className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-extrabold text-slate-900">
                      {getUserName(u)}
                    </div>
                    <div className="mt-0.5 text-xs font-semibold text-slate-600">
                      {roleLabel(role)}
                      {uid === myId ? " · You" : ""}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {isHost ? (
                      <span className="rounded-full bg-slate-900 px-3 py-2 text-xs font-extrabold text-white">
                        Host
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={!canEdit}
                        onClick={() => toggleCoHost(uid, !isCoHost)}
                        className={[
                          "rounded-xl px-3 py-2 text-xs font-extrabold ring-1",
                          !canEdit
                            ? "bg-slate-50 text-slate-400 ring-slate-200 cursor-not-allowed"
                            : isCoHost
                            ? "bg-emerald-600 text-white ring-emerald-600 hover:bg-emerald-500"
                            : "bg-white text-slate-900 ring-slate-200 hover:bg-slate-50",
                        ].join(" ")}
                        title={isCoHost ? "Remove co-host" : "Make co-host"}
                      >
                        {isCoHost ? "Co-host ✓" : "Make co-host"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="mt-3 text-[11px] font-semibold text-slate-500">
          Permissions on this page are Supabase truth (league_members). Cached roles here are display-only.
        </div>
      </Card>
    </div>
  );
}




