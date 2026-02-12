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

function getLeagueIdFromLocation(location) {
  // Priority: navigation state, then query string
  const stateId = location?.state?.leagueId || location?.state?.id || null;
  if (stateId) return stateId;

  try {
    const sp = new URLSearchParams(location?.search || "");
    const q = sp.get("leagueId") || sp.get("league_id");
    if (q) return q;
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

  // ✅ REMOVED: useless useMemo that returned a value you never used.
  // useMemo(() => getPointsSystem(null), [league?.pointsSystem]);

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

  // display fallback "me"
  const me = useMemo(() => {
    if (authUserId) return users.find((u) => getUserId(u) === authUserId) || null;
    return users?.[0] || null;
  }, [authUserId, users]);

  const myId = authUserId || getUserId(me);
  const myDisplayName = myProfile?.display_name || getUserName(me);

  /**
   * ✅ Permission logic (fix):
   * Prefer Supabase league_members role (myRoleLive),
   * but FALL BACK to:
   * - leagues.host_user_id === authUserId
   * - cached league.memberRoles[authUserId] (populated by syncActiveLeagueFromSupabase)
   */
  const cachedRole = useMemo(() => {
    if (!authUserId) return null;
    const roles = ensureObj(league?.memberRoles);
    return roles[authUserId] || null;
  }, [league?.memberRoles, authUserId]);

  const isHostByLeagueRow = Boolean(authUserId && league?.host_user_id && league.host_user_id === authUserId);

  const effectiveRole =
    myRoleLive ||
    (isHostByLeagueRow ? LEAGUE_ROLES.host : null) ||
    cachedRole ||
    LEAGUE_ROLES.member;

  const canEdit =
    effectiveRole === LEAGUE_ROLES.host || effectiveRole === LEAGUE_ROLES.co_host;

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

  /**
   * ✅ Freeze leagueId ASAP from navigation state/query (so refresh/back doesn’t break).
   * This runs whenever location changes and sets stableLeagueIdRef if not already set.
   */
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
    const cachedLeagueId = cachedLeague?.id || null;

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
    if (!leagueId) return;

    const reqId = ++leagueReqIdRef.current;

    try {
      const { data, error } = await supabase
        .from("leagues")
        .select("*")
        .eq("id", leagueId)
        .single();

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

    const current = stableLeagueIdRef.current;

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

      const hostish = list.find(
        (r) => r?.role === LEAGUE_ROLES.host || r?.role === LEAGUE_ROLES.co_host
      );
      const pick = hostish?.league_id || list[0]?.league_id || null;
      if (!pick) return;

      stableLeagueIdRef.current = pick;
      await refreshLeagueFromSupabase(pick);
    } catch {
      // ignore
    }
  }

  async function refreshMyProfileAndRole() {
    const leagueId = stableLeagueIdRef.current;
    if (!authUserId || !leagueId) return;

    const reqId = ++roleReqIdRef.current;
    setRoleLoading(true);

    try {
      // Profile (nice-to-have)
      const { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select("id, display_name")
        .eq("id", authUserId)
        .single();

      if (reqId !== roleReqIdRef.current) return;
      if (!profErr) setMyProfile(prof || null);

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

      // optional cache alignment (for other screens)
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

      const leagueId = stableLeagueIdRef.current;
      if (leagueId) await refreshLeagueFromSupabase(leagueId);

      await refreshMyProfileAndRole();
    })();
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

  useEffect(() => {
    if (!myId) return;
    loadFriendsForInvites({ userId: myId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId]);

  useEffect(() => {
    const leagueId = stableLeagueIdRef.current || league?.id || null;
    if (!leagueId) return;

    if (!canEdit) {
      setPendingInvites([]);
      return;
    }

    loadPendingInvites({ leagueId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit]);

  const stableLeagueId = stableLeagueIdRef.current || league?.id || null;

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

  // (rest of your file unchanged)
  // NOTE: kept everything below identical to your original.
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

    const leagueId = stableLeagueIdRef.current || league?.id || null;
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

    const leagueId = stableLeagueIdRef.current || league?.id || null;
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

  // ✅ Your JSX return unchanged below...
  return (
    <div className="space-y-6">
      {/* ... keep your existing JSX exactly as you had it ... */}
      {/* (omitted here only because it’s long, but keep it in your file) */}
    </div>
  );
}
