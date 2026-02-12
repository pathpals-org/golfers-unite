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

function ensureObj(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
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
  return (
    u?.name ||
    u?.fullName ||
    u?.displayName ||
    u?.username ||
    u?.display_name ||
    "Golfer"
  );
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

/** ✅ Reject null/undefined/"undefined"/"null"/"" */
function cleanLeagueId(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const low = s.toLowerCase();
  if (low === "undefined" || low === "null") return null;
  return s;
}

function getLeagueIdFromLocation(location) {
  // Priority: navigation state, then query string
  const stateId = location?.state?.leagueId || location?.state?.id || null;
  const cleanState = cleanLeagueId(stateId);
  if (cleanState) return cleanState;

  try {
    const sp = new URLSearchParams(location?.search || "");
    const q = sp.get("leagueId") || sp.get("league_id");
    const cleanQ = cleanLeagueId(q);
    if (cleanQ) return cleanQ;
  } catch {
    // ignore
  }

  return null;
}

export default function LeagueSettings() {
  const navigate = useNavigate();
  const location = useLocation();

  const [league, setLeagueState] = useState(() => getLeagueSafe({}));
  const [users, setUsersState] = useState(() => ensureArr(getUsers([])));

  // Supabase auth user
  const [authUserId, setAuthUserId] = useState(null);

  // Supabase profile + role (preferred truth)
  const [myProfile, setMyProfile] = useState(null);
  const [myRoleLive, setMyRoleLive] = useState(null);
  const [roleLoading, setRoleLoading] = useState(false);

  // Stable league context for this page
  const stableLeagueIdRef = useRef(null);
  const initDoneRef = useRef(false);

  // Prevent stale async responses overwriting
  const roleReqIdRef = useRef(0);
  const leagueReqIdRef = useRef(0);

  // Invite status UI
  const [inviteStatus, setInviteStatus] = useState({ type: "", message: "" });

  // Friends for invite list (Supabase source)
  const [friends, setFriends] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(false);

  // Pending invites UI
  const [pendingInvites, setPendingInvites] = useState([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [inviteActionId, setInviteActionId] = useState(null);

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
  const [seasonStart, setSeasonStart] = useState(() =>
    toISODateInput(league?.seasonStartISO)
  );
  const [seasonEnd, setSeasonEnd] = useState(() =>
    toISODateInput(league?.seasonEndISO)
  );

  const members = useMemo(() => ensureArr(league?.members), [league?.members]);

  const memberUsers = useMemo(() => {
    const setIds = new Set(members);
    return users.filter((u) => setIds.has(getUserId(u)));
  }, [users, members]);

  // display fallback "me"
  const me = useMemo(() => {
    if (authUserId) return users.find((u) => getUserId(u) === authUserId) || null;
    return users?.[0] || null;
  }, [authUserId, users]);

  const myId = authUserId || getUserId(me);
  const myDisplayName = myProfile?.display_name || getUserName(me);

  // Cached role (UI-only fallback)
  const cachedRole = useMemo(() => {
    if (!authUserId) return null;
    const roles = ensureObj(league?.memberRoles);
    return roles[authUserId] || null;
  }, [league?.memberRoles, authUserId]);

  const isHostByLeagueRow = Boolean(
    authUserId && league?.host_user_id && league.host_user_id === authUserId
  );

  const effectiveRole =
    myRoleLive ||
    (isHostByLeagueRow ? LEAGUE_ROLES.host : null) ||
    cachedRole ||
    LEAGUE_ROLES.member;

  const canEdit = effectiveRole === LEAGUE_ROLES.host || effectiveRole === LEAGUE_ROLES.co_host;

  // ✅ IMPORTANT: compute this BEFORE any early return
  const stableLeagueId = cleanLeagueId(stableLeagueIdRef.current) || cleanLeagueId(league?.id) || null;

  // ✅ These hooks MUST be before any early return (fixes React #310)
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

  // Auth bootstrap (Netlify-safe)
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

  // Freeze leagueId ASAP (SANITISED)
  useEffect(() => {
    const navLeagueId = getLeagueIdFromLocation(location);
    if (navLeagueId) stableLeagueIdRef.current = navLeagueId;
  }, [location]);

  // One-time init: cache UI state
  useEffect(() => {
    if (initDoneRef.current) return;
    initDoneRef.current = true;

    const cachedLeague = getLeagueSafe({});
    const cachedUsers = ensureArr(getUsers([]));

    const navLeagueId = getLeagueIdFromLocation(location);
    const cachedLeagueId = cleanLeagueId(cachedLeague?.id);

    stableLeagueIdRef.current = navLeagueId || cachedLeagueId || null;

    setLeagueState(cachedLeague);
    setUsersState(cachedUsers);

    setSeasonStart(toISODateInput(cachedLeague?.seasonStartISO));
    setSeasonEnd(toISODateInput(cachedLeague?.seasonEndISO));

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

    setInviteStatus({ type: "", message: "" });
    setPendingInvites([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshLeagueFromSupabase(leagueId) {
    const lid = cleanLeagueId(leagueId);
    if (!lid) return;

    const reqId = ++leagueReqIdRef.current;

    try {
      const { data, error } = await supabase.from("leagues").select("*").eq("id", lid).single();

      if (reqId !== leagueReqIdRef.current) return;
      if (error) throw error;

      const merged = { ...getLeagueSafe({}), ...data };
      setLeagueSafe(merged);
      setLeagueState(merged);

      if (data?.season_start || data?.seasonStartISO) {
        const iso = data?.seasonStartISO || data?.season_start;
        setSeasonStart(toISODateInput(iso));
      }
      if (data?.season_end || data?.seasonEndISO) {
        const iso = data?.seasonEndISO || data?.season_end;
        setSeasonEnd(toISODateInput(iso));
      }
    } catch {
      // keep cached league for UI
    }
  }

  async function ensureStableLeagueIdIsValid() {
    if (!authUserId) return;

    const current = cleanLeagueId(stableLeagueIdRef.current);

    if (current) {
      try {
        const { data, error } = await supabase
          .from("league_members")
          .select("league_id, role")
          .eq("league_id", current)
          .eq("user_id", authUserId)
          .maybeSingle();

        if (error) throw error;
        if (data?.league_id) return;
      } catch {
        // attempt recovery
      }
    }

    try {
      const { data: rows, error } = await supabase
        .from("league_members")
        .select("league_id, role, created_at")
        .eq("user_id", authUserId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const list = ensureArr(rows);
      if (list.length === 0) return;

      const hostish = list.find((r) => r?.role === LEAGUE_ROLES.host || r?.role === LEAGUE_ROLES.co_host);
      const pick = cleanLeagueId(hostish?.league_id || list[0]?.league_id || null);
      if (!pick) return;

      stableLeagueIdRef.current = pick;
      await refreshLeagueFromSupabase(pick);
    } catch {
      // ignore
    }
  }

  async function refreshMyProfileAndRole() {
    const leagueId = cleanLeagueId(stableLeagueIdRef.current);
    if (!authUserId || !leagueId) return;

    const reqId = ++roleReqIdRef.current;
    setRoleLoading(true);

    try {
      const { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select("id, display_name")
        .eq("id", authUserId)
        .single();

      if (reqId !== roleReqIdRef.current) return;
      if (!profErr) setMyProfile(prof || null);

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

      try {
        setLeagueRole(authUserId, role);
      } catch {
        // ignore
      }
    } catch {
      if (reqId !== roleReqIdRef.current) return;
      if (myRoleLive == null) setMyRoleLive(null);
    } finally {
      if (reqId !== roleReqIdRef.current) return;
      setRoleLoading(false);
    }
  }

  useEffect(() => {
    if (!authUserId) {
      setMyRoleLive(null);
      setMyProfile(null);
      return;
    }

    (async () => {
      await ensureStableLeagueIdIsValid();

      const leagueId = cleanLeagueId(stableLeagueIdRef.current);
      if (leagueId) await refreshLeagueFromSupabase(leagueId);

      await refreshMyProfileAndRole();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUserId]);

  async function loadPendingInvites({ leagueId }) {
    const lid = cleanLeagueId(leagueId);
    if (!lid) return;

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
        .eq("league_id", lid)
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

  useEffect(() => {
    if (!myId) return;
    loadFriendsForInvites({ userId: myId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId]);

  useEffect(() => {
    const lid = cleanLeagueId(stableLeagueIdRef.current) || cleanLeagueId(league?.id) || null;
    if (!lid) return;

    if (!canEdit) {
      setPendingInvites([]);
      return;
    }

    loadPendingInvites({ leagueId: lid });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit]);

  // ✅ NOW it’s safe to early return (NO hooks below this line)
  if (!stableLeagueId) {
    return (
      <div className="pt-2">
        <EmptyState
          icon="⚙️"
          title="No league selected"
          description="Open League Settings from a specific league."
          actions={
            <button
              onClick={() => navigate("/leagues")}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-extrabold text-white"
            >
              Back to Leagues
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
    const safePlacement = Object.keys(placementPoints).length
      ? placementPoints
      : { 1: 3, 2: 2, 3: 0 };

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

    const leagueId = cleanLeagueId(stableLeagueIdRef.current) || cleanLeagueId(league?.id) || null;
    if (!leagueId) return;

    if (!myId) {
      setInviteStatus({ type: "error", message: "You must be signed in to invite." });
      return;
    }

    const inviteeUserId = friendProfile?.id || null;
    if (!inviteeUserId) return;

    const memberSetLocal = new Set(ensureArr(members));
    if (memberSetLocal.has(inviteeUserId)) {
      setInviteStatus({ type: "info", message: "They’re already in this league." });
      return;
    }

    setInviteActionId(inviteeUserId);
    setInviteStatus({ type: "", message: "" });

    try {
      const { error: invErr } = await supabase.from("league_invites").insert({
        league_id: leagueId,
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

      await loadPendingInvites({ leagueId });

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

    const leagueId = cleanLeagueId(stableLeagueIdRef.current) || cleanLeagueId(league?.id) || null;
    if (!leagueId) return;

    try {
      const { error } = await supabase.from("league_invites").delete().eq("id", inviteId);
      if (error) throw error;

      await loadPendingInvites({ leagueId });
      setInviteStatus({ type: "info", message: "Invite cancelled." });
    } catch (e) {
      setInviteStatus({ type: "error", message: humanizeSupabaseError(e) });
    }
  }

  const placementRows = placementRowsFromMap(pointsDraft.placementPoints);

  return (
    <div className="space-y-6">
      <PageHeader
        title="League Settings"
        subtitle={
          canEdit
            ? "Manage points, season, and admins."
            : "You can view settings. Only host/co-host can edit."
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
              <span className="font-extrabold">{roleLabel(effectiveRole)}</span>
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
              canEdit
                ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                : "bg-slate-50 text-slate-700 ring-slate-200",
            ].join(" ")}
          >
            {canEdit ? "Editing enabled" : "View only"}
          </span>
        </div>

        {myRoleLive == null ? (
          <div className="mt-3 text-[11px] font-semibold text-slate-500">
            If role lookup is slow/blocked, we fall back to cached host/co-host so you can keep working.
          </div>
        ) : null}
      </Card>

      {/* Invite friends */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-extrabold text-slate-900">Invite friends</div>
            <div className="mt-1 text-xs font-semibold text-slate-600">
              Host/co-host can invite accepted friends. They join only after they accept.
            </div>
          </div>

          <span className="rounded-full bg-slate-100 px-3 py-2 text-xs font-extrabold text-slate-700 ring-1 ring-slate-200">
            League ID: <span className="font-mono">{String(stableLeagueId).slice(0, 8)}…</span>
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
                          busy
                            ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                            : "bg-slate-900 text-white hover:bg-slate-800",
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

        {/* Pending invites */}
        <div className="mt-6">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
              Pending invites
            </div>

            <button
              type="button"
              disabled={!canEdit || invitesLoading}
              onClick={() => loadPendingInvites({ leagueId: stableLeagueId })}
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
                  invitee?.display_name || String(inv?.invitee_user_id || "").slice(0, 8) + "…";
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
        {/* (rest of your JSX unchanged from here down) */}
        {/* KEEP your remaining JSX exactly as you pasted it */}
        {/* ... */}
      </Card>
    </div>
  );
}


