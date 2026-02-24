// src/pages/LeagueSettings.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Card from "../components/ui/Card";
import EmptyState from "../components/ui/EmptyState";
import PageHeader from "../components/ui/PageHeader";

import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/useAuth";

import {
  // UI cache getters (safe)
  getLeagueSafe,
  getUsers,
  getPointsSystem,

  // ✅ Supabase-first storage layer
  syncActiveLeagueFromSupabase,
  getActiveLeagueIdSupabaseFirst,
  setActiveLeagueId,
  getMyLeagueRoleSupabase,
  setMemberRoleSupabase,
  setPointsSystemSupabase,

  LEAGUE_ROLES,

  // cache-only season helpers (UI-only)
  setLeagueSeasonDates,

  // ✅ low-level cache helpers so we can “reset after delete/leave”
  KEYS,
  remove,
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

/** state -> query */
function getLeagueIdFromLocation(location) {
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
  const { user, loading: authLoading } = useAuth();

  const authUserId = user?.id || null;

  const [league, setLeagueState] = useState(() => getLeagueSafe({}));
  const [users, setUsersState] = useState(() => ensureArr(getUsers([])));

  // Stable leagueId for this page
  const [leagueId, setLeagueId] = useState(() => getLeagueIdFromLocation(location));

  // Live role (source of truth)
  const [myRoleLive, setMyRoleLive] = useState(null);
  const [roleLoading, setRoleLoading] = useState(false);

  // Prevent stale async overwrites
  const hydrateReqIdRef = useRef(0);
  const roleReqIdRef = useRef(0);
  const resolveReqIdRef = useRef(0);

  // Invite status UI (also used for errors)
  const [inviteStatus, setInviteStatus] = useState({ type: "", message: "" });

  // Friends + invites
  const [friends, setFriends] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(false);

  const [pendingInvites, setPendingInvites] = useState([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [inviteActionId, setInviteActionId] = useState(null);

  // Delete league
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  // ✅ Member actions
  const [memberActionBusyId, setMemberActionBusyId] = useState(null);

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

  // season dates draft (UI-only for now)
  const [seasonStart, setSeasonStart] = useState(() => toISODateInput(league?.seasonStartISO));
  const [seasonEnd, setSeasonEnd] = useState(() => toISODateInput(league?.seasonEndISO));

  const members = useMemo(() => ensureArr(league?.members), [league?.members]);

  const memberUsers = useMemo(() => {
    const setIds = new Set(members);
    return users.filter((u) => setIds.has(getUserId(u)));
  }, [users, members]);

  const me = useMemo(() => {
    if (authUserId) return users.find((u) => getUserId(u) === authUserId) || null;
    return users?.[0] || null;
  }, [authUserId, users]);

  const myId = authUserId || getUserId(me);
  const myDisplayName = getUserName(me);

  // ✅ Permissions based ONLY on Supabase role
  const effectiveRole = myRoleLive || LEAGUE_ROLES.member;
  const canEdit = effectiveRole === LEAGUE_ROLES.host || effectiveRole === LEAGUE_ROLES.co_host;

  // ✅ final stable id for this render
  const stableLeagueId = cleanLeagueId(leagueId) || cleanLeagueId(league?.id) || null;

  // ✅ MUST be above early return (hooks rule)
  const placementRows = placementRowsFromMap(pointsDraft.placementPoints);

  const memberSet = useMemo(() => new Set(ensureArr(members)), [members]);
  const pendingInviteeSet = useMemo(
    () =>
      new Set(
        ensureArr(pendingInvites)
          .map((x) => x?.invitee_user_id)
          .filter(Boolean)
      ),
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

  async function fetchMyRoleDirect({ lid, uid }) {
    const { data, error } = await supabase
      .from("league_members")
      .select("role,status")
      .eq("league_id", lid)
      .eq("user_id", uid)
      .maybeSingle();

    if (error) throw error;
    if (data?.status && String(data.status) !== "active") return null;
    return data?.role || null;
  }

  /**
   * ✅ Resolve leagueId (state -> query -> activeLeagueId -> membership fallback)
   * Trigger: navigation changes and login.
   */
  useEffect(() => {
    if (authLoading) return;

    let alive = true;
    const reqId = ++resolveReqIdRef.current;

    async function resolveLeagueId() {
      // 1) state/query
      const fromNav = getLeagueIdFromLocation(location);
      if (!alive || reqId !== resolveReqIdRef.current) return;
      if (fromNav) {
        setLeagueId(String(fromNav));
        return;
      }

      if (!authUserId) {
        setLeagueId(null);
        return;
      }

      // 2) activeLeagueId pref (Supabase first, local fallback)
      const pref = await getActiveLeagueIdSupabaseFirst();
      if (!alive || reqId !== resolveReqIdRef.current) return;
      const cleanPref = cleanLeagueId(pref);
      if (cleanPref) {
        setLeagueId(String(cleanPref));
        return;
      }

      // 3) membership fallback (most recent)
      try {
        // ✅ FIX: league_members has joined_at, NOT created_at
        const { data, error } = await supabase
          .from("league_members")
          .select("league_id, joined_at")
          .eq("user_id", authUserId)
          .order("joined_at", { ascending: false })
          .limit(1);

        if (!alive || reqId !== resolveReqIdRef.current) return;
        if (error) throw error;

        const first = ensureArr(data)[0]?.league_id || null;
        const cleanFirst = cleanLeagueId(first);
        if (cleanFirst) setLeagueId(String(cleanFirst));
      } catch {
        // fail-soft
      }
    }

    resolveLeagueId();

    return () => {
      alive = false;
    };
  }, [authLoading, authUserId, location.key]);

  /**
   * ✅ Hydrate page data for the resolved leagueId.
   * Supabase truth -> cache -> state.
   */
  useEffect(() => {
    let alive = true;

    async function hydrate() {
      const lid = cleanLeagueId(leagueId);
      if (!lid) return;

      const reqId = ++hydrateReqIdRef.current;

      setLeagueState(getLeagueSafe({}));
      setUsersState(ensureArr(getUsers([])));

      try {
        const result = await syncActiveLeagueFromSupabase({
          leagueId: lid,
          withRounds: false,
        });

        if (!alive) return;
        if (reqId !== hydrateReqIdRef.current) return;

        const l = result?.league || null;
        const u = ensureArr(result?.users);

        if (l?.id) {
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

          // eslint-disable-next-line no-void
          void setActiveLeagueId(l.id);
        }
      } catch {
        // fail-soft
      }
    }

    hydrate();

    return () => {
      alive = false;
    };
  }, [leagueId]);

  /**
   * ✅ Fetch my role from Supabase (source of truth) whenever leagueId/auth changes.
   */
  useEffect(() => {
    let alive = true;

    async function refreshRole() {
      const lid = cleanLeagueId(leagueId);
      if (!authUserId || !lid) {
        setMyRoleLive(null);
        return;
      }

      const reqId = ++roleReqIdRef.current;
      setRoleLoading(true);
      setInviteStatus((s) => (s?.type === "error" ? { type: "", message: "" } : s));

      try {
        let role = null;

        try {
          role = await fetchMyRoleDirect({ lid, uid: authUserId });
        } catch {
          role = await getMyLeagueRoleSupabase(lid);
        }

        if (!alive) return;
        if (reqId !== roleReqIdRef.current) return;

        if (!role) {
          setMyRoleLive(LEAGUE_ROLES.member);
          setInviteStatus({
            type: "error",
            message:
              "Couldn’t read your league role from Supabase. This is usually an RLS policy issue on league_members. (You’ll be view-only until it’s fixed.)",
          });
          return;
        }

        setMyRoleLive(role);
      } catch (e) {
        if (!alive) return;
        if (reqId !== roleReqIdRef.current) return;

        setMyRoleLive(LEAGUE_ROLES.member);
        setInviteStatus({
          type: "error",
          message:
            "Role check failed (Supabase blocked it). You’ll be view-only until league_members SELECT policy allows members to read their own role. " +
            `Error: ${humanizeSupabaseError(e)}`,
        });
      } finally {
        if (!alive) return;
        if (reqId !== roleReqIdRef.current) return;
        setRoleLoading(false);
      }
    }

    refreshRole();

    return () => {
      alive = false;
    };
  }, [authUserId, leagueId]);

  async function loadPendingInvites({ leagueId: lid }) {
    const clean = cleanLeagueId(lid);
    if (!clean) return;

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
            display_name,
            username
          )
        `
        )
        .eq("league_id", clean)
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

  // ✅ FIXED: read friendships using requester_id / addressee_id
  async function loadFriendsForInvites({ userId }) {
    if (!userId) {
      setFriends([]);
      return;
    }

    setFriendsLoading(true);
    try {
      let rows = [];
      {
        const res = await supabase
          .from("friendships")
          .select("id,requester_id,addressee_id,status")
          .eq("status", "accepted")
          .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);

        if (!res.error) {
          rows = ensureArr(res.data);
        } else {
          const msg = String(res.error?.message || "").toLowerCase();
          if (msg.includes("column") && msg.includes("does not exist")) {
            const fallback = await supabase
              .from("friendships")
              .select("id,user_low,user_high,status")
              .eq("status", "accepted")
              .or(`user_low.eq.${userId},user_high.eq.${userId}`);

            if (fallback.error) throw fallback.error;
            rows = ensureArr(fallback.data);
          } else {
            throw res.error;
          }
        }
      }

      const friendIds = rows
        .map((r) => {
          if (r?.requester_id && r?.addressee_id) {
            return r.requester_id === userId ? r.addressee_id : r.requester_id;
          }
          if (r?.user_low && r?.user_high) {
            return r.user_low === userId ? r.user_high : r.user_low;
          }
          return null;
        })
        .filter(Boolean);

      const uniq = Array.from(new Set(friendIds));

      if (uniq.length === 0) {
        setFriends([]);
        return;
      }

      const { data: profs, error: profErr } = await supabase
        .from("profiles")
        .select("id,display_name,username")
        .in("id", uniq);

      if (profErr) throw profErr;

      const next = ensureArr(profs).sort((a, b) => {
        const an = String(a?.display_name || a?.username || "").toLowerCase();
        const bn = String(b?.display_name || b?.username || "").toLowerCase();
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
    const lid = cleanLeagueId(stableLeagueId);
    if (!lid) return;

    if (!canEdit) {
      setPendingInvites([]);
      return;
    }

    loadPendingInvites({ leagueId: lid });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, stableLeagueId]);

  async function hardRefreshAll() {
    const lid = cleanLeagueId(stableLeagueId);
    if (!lid) return;

    setInviteStatus({ type: "", message: "" });

    try {
      await syncActiveLeagueFromSupabase({ leagueId: lid, withRounds: false });
      setLeagueState(getLeagueSafe({}));
      setUsersState(ensureArr(getUsers([])));

      if (authUserId) {
        const r = await getMyLeagueRoleSupabase(lid);
        setMyRoleLive(r);
      }

      if (myId) await loadFriendsForInvites({ userId: myId });
      await loadPendingInvites({ leagueId: lid });
    } catch (e) {
      setInviteStatus({ type: "error", message: humanizeSupabaseError(e) });
    }
  }

  // ✅ Central reset used after delete/leave so you DON'T have to log out/in
  function clearLeagueUiCachesNow() {
    try {
      remove(KEYS.league);
      remove(KEYS.users);
      remove(KEYS.rounds);
      remove(KEYS.activeLeagueId);
    } catch {
      // ignore
    }
  }

  async function deleteLeagueNow() {
    const lid = cleanLeagueId(stableLeagueId);
    if (!lid) return;
    if (!canEdit || effectiveRole !== LEAGUE_ROLES.host) {
      setInviteStatus({ type: "error", message: "Only the Host can delete a league." });
      return;
    }

    if (deleteConfirm.trim().toUpperCase() !== "DELETE") {
      setInviteStatus({ type: "info", message: 'Type "DELETE" to confirm.' });
      return;
    }

    setDeleteBusy(true);
    setInviteStatus({ type: "", message: "" });

    try {
      const steps = [
        () => supabase.from("league_invites").delete().eq("league_id", lid),
        () => supabase.from("league_members").delete().eq("league_id", lid),
        () => supabase.from("rounds").delete().eq("league_id", lid),
        () => supabase.from("leagues").delete().eq("id", lid),
      ];

      for (const run of steps) {
        // eslint-disable-next-line no-await-in-loop
        const { error } = await run();
        if (error) throw error;
      }

      await setActiveLeagueId(null);
      clearLeagueUiCachesNow();

      setLeagueId(null);
      setLeagueState(getLeagueSafe({}));
      setUsersState(ensureArr(getUsers([])));
      setMyRoleLive(null);

      setInviteStatus({ type: "success", message: "League deleted ✅" });

      navigate("/leagues", { replace: true, state: { justDeleted: true } });
    } catch (e) {
      setInviteStatus({
        type: "error",
        message:
          "Delete failed. This is usually an RLS policy or foreign-key constraint issue. " +
          humanizeSupabaseError(e),
      });
    } finally {
      setDeleteBusy(false);
      setDeleteConfirm("");
    }
  }

  // ✅ NEW: Remove member / Leave league
  async function removeMember(userId) {
    const lid = cleanLeagueId(stableLeagueId);
    if (!lid || !userId) return;

    // only admin can remove; and keep it simple: host can't remove self here
    if (!canEdit) {
      setInviteStatus({ type: "error", message: "Only host/co-host can remove members." });
      return;
    }
    if (effectiveRole === LEAGUE_ROLES.host && userId === myId) {
      setInviteStatus({
        type: "info",
        message: "Host can’t remove themselves here. (Delete league, or transfer host in a future step.)",
      });
      return;
    }

    setMemberActionBusyId(userId);
    setInviteStatus({ type: "", message: "" });

    try {
      const { error } = await supabase
        .from("league_members")
        .delete()
        .eq("league_id", lid)
        .eq("user_id", userId);

      if (error) throw error;

      await syncActiveLeagueFromSupabase({ leagueId: lid, withRounds: false });
      setLeagueState(getLeagueSafe({}));
      setUsersState(ensureArr(getUsers([])));

      setInviteStatus({ type: "success", message: "Member removed ✅" });
    } catch (e) {
      setInviteStatus({
        type: "error",
        message:
          "Remove failed (usually RLS). " +
          "Your league_members DELETE policy must allow host/co-host to delete member rows. " +
          humanizeSupabaseError(e),
      });
    } finally {
      setMemberActionBusyId(null);
    }
  }

  async function leaveLeague() {
    const lid = cleanLeagueId(stableLeagueId);
    if (!lid || !myId) return;

    // host leaving is dangerous (league becomes orphaned). Keep it simple and block for now.
    if (effectiveRole === LEAGUE_ROLES.host) {
      setInviteStatus({
        type: "info",
        message: "Host can’t leave right now. (Transfer host or delete league — we can add transfer next.)",
      });
      return;
    }

    setMemberActionBusyId(myId);
    setInviteStatus({ type: "", message: "" });

    try {
      const { error } = await supabase
        .from("league_members")
        .delete()
        .eq("league_id", lid)
        .eq("user_id", myId);

      if (error) throw error;

      // Clear active league + UI caches
      await setActiveLeagueId(null);
      clearLeagueUiCachesNow();

      setInviteStatus({ type: "success", message: "You left the league." });
      navigate("/leagues", { replace: true });
    } catch (e) {
      setInviteStatus({
        type: "error",
        message:
          "Leave failed (usually RLS). " +
          "Your league_members DELETE policy must allow users to delete their own membership row. " +
          humanizeSupabaseError(e),
      });
    } finally {
      setMemberActionBusyId(null);
    }
  }

  if (!stableLeagueId) {
    return (
      <div className="pt-2">
        <EmptyState
          icon="⚙️"
          title={authLoading ? "Loading…" : "No league selected"}
          description={
            authLoading
              ? "Checking your account…"
              : "Open League Settings from a specific league, or create a league first."
          }
          actions={
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => navigate("/leagues")}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-extrabold text-white"
              >
                Back to Leagues
              </button>

              <button
                onClick={() => navigate("/leagues?create=1")}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-emerald-500"
                title="Opens the create league flow"
              >
                + Create League
              </button>
            </div>
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

  async function savePointsSystem() {
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

    try {
      await setPointsSystemSupabase({ leagueId: stableLeagueId, pointsSystem: merged });
      await syncActiveLeagueFromSupabase({ leagueId: stableLeagueId, withRounds: false });
      setLeagueState(getLeagueSafe({}));
    } catch (e) {
      setInviteStatus({ type: "error", message: humanizeSupabaseError(e) });
    }
  }

  function saveSeasonDates() {
    if (!canEdit) return;

    const startISO = fromISODateInput(seasonStart) || league?.seasonStartISO;
    const endISO = seasonEnd ? fromISODateInput(seasonEnd) : null;

    const next = setLeagueSeasonDates({ startISO, endISO });
    setLeagueState(next);
  }

  async function toggleCoHost(userId, makeCoHost) {
    if (!canEdit) return;
    if (!userId) return;

    try {
      await setMemberRoleSupabase({
        leagueId: stableLeagueId,
        userId,
        role: makeCoHost ? LEAGUE_ROLES.co_host : LEAGUE_ROLES.member,
      });

      await syncActiveLeagueFromSupabase({ leagueId: stableLeagueId, withRounds: false });
      setLeagueState(getLeagueSafe({}));
      setUsersState(ensureArr(getUsers([])));

      if (authUserId && userId === authUserId) {
        const r = await getMyLeagueRoleSupabase(stableLeagueId);
        setMyRoleLive(r);
      }
    } catch (e) {
      setInviteStatus({ type: "error", message: humanizeSupabaseError(e) });
    }
  }

  async function sendInviteToFriend(friendProfile) {
    if (!canEdit) return;

    const lid = stableLeagueId;
    if (!lid) return;

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
        league_id: lid,
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

      await loadPendingInvites({ leagueId: lid });

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

    const lid = stableLeagueId;
    if (!lid) return;

    try {
      const { error } = await supabase.from("league_invites").delete().eq("id", inviteId);
      if (error) throw error;

      await loadPendingInvites({ leagueId: lid });
      setInviteStatus({ type: "info", message: "Invite cancelled." });
    } catch (e) {
      setInviteStatus({ type: "error", message: humanizeSupabaseError(e) });
    }
  }

  // ✅ helper for member role display
  function roleForUser(uid) {
    const cachedRole = ensureObj(league?.memberRoles || {})[uid] || LEAGUE_ROLES.member;
    return cachedRole;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="League Settings"
        subtitle={
          canEdit ? "Manage points, members, and admins." : "You can view settings. Only host/co-host can edit."
        }
        right={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={hardRefreshAll}
              className="rounded-xl bg-white px-4 py-2 text-sm font-extrabold text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50"
              title="Re-sync league + refresh role"
            >
              Refresh
            </button>

            <button
              type="button"
              onClick={() => navigate("/leagues")}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-extrabold text-white hover:bg-slate-800"
            >
              Back
            </button>
          </div>
        }
      />

      {/* Status */}
      {inviteStatus?.message ? (
        <Card className="p-4">
          <div
            className={[
              "rounded-2xl px-4 py-3 text-sm font-semibold ring-1",
              inviteStatus.type === "success"
                ? "bg-emerald-50 text-emerald-900 ring-emerald-200"
                : inviteStatus.type === "info"
                ? "bg-slate-50 text-slate-800 ring-slate-200"
                : "bg-rose-50 text-rose-900 ring-rose-200",
            ].join(" ")}
          >
            {inviteStatus.message}
          </div>
        </Card>
      ) : null}

      {/* Current context */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-extrabold text-slate-900">Current context</div>
            <div className="mt-1 text-xs font-semibold text-slate-600">
              LeagueId: <span className="font-mono">{stableLeagueId}</span>
            </div>
            <div className="mt-1 text-xs font-semibold text-slate-600">
              Your user id (Supabase auth):{" "}
              <span className="font-mono">{authUserId || "not signed in"}</span>
            </div>
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

        <div className="mt-3 text-[11px] font-semibold text-slate-500">
          Permissions are based only on Supabase <span className="font-mono">league_members.role</span>.
        </div>
      </Card>

      {/* Members (NEW + IMPORTANT) */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-extrabold text-slate-900">Members</div>
            <div className="mt-1 text-xs font-semibold text-slate-600">
              Host/co-host can remove members. Members can leave.
            </div>
          </div>

          <button
            type="button"
            disabled={memberActionBusyId === myId}
            onClick={leaveLeague}
            className={[
              "rounded-xl px-3 py-2 text-xs font-extrabold",
              effectiveRole === LEAGUE_ROLES.host
                ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                : "bg-rose-600 text-white hover:bg-rose-500",
            ].join(" ")}
            title={effectiveRole === LEAGUE_ROLES.host ? "Host can’t leave (transfer host or delete league)" : "Leave this league"}
          >
            Leave league
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {memberUsers.length === 0 ? (
            <div className="text-sm font-semibold text-slate-600">No members found.</div>
          ) : (
            memberUsers.map((u) => {
              const uid = getUserId(u);
              const name = getUserName(u);
              const role = roleForUser(uid);
              const isHost = role === LEAGUE_ROLES.host;

              const canRemoveThis =
                canEdit &&
                uid !== myId && // don't remove yourself here
                !isHost; // keep it simple: don't remove host

              const busy = memberActionBusyId === uid;

              return (
                <div
                  key={uid}
                  className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-extrabold text-slate-900">
                      {name} {uid === myId ? <span className="text-slate-500">(You)</span> : null}
                    </div>
                    <div className="mt-0.5 text-xs font-semibold text-slate-600">
                      {roleLabel(role)}
                    </div>
                  </div>

                  {canRemoveThis ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => removeMember(uid)}
                      className={[
                        "rounded-xl px-3 py-2 text-xs font-extrabold",
                        busy ? "bg-slate-200 text-slate-500 cursor-not-allowed" : "bg-rose-600 text-white hover:bg-rose-500",
                      ].join(" ")}
                      title="Remove member"
                    >
                      {busy ? "Removing…" : "Remove"}
                    </button>
                  ) : (
                    <span className="rounded-full bg-white px-3 py-2 text-xs font-extrabold text-slate-700 ring-1 ring-slate-200">
                      {isHost ? "Host" : "—"}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="mt-3 text-[11px] font-semibold text-slate-500">
          If Remove/Leave fails, it’s almost always a <span className="font-mono">league_members</span> DELETE RLS policy issue.
        </div>
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
              Friends not in this league
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => navigate("/friends")}
                className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-extrabold text-slate-900 hover:bg-slate-200"
                title="Go add friends first"
              >
                + Add friends
              </button>

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
          </div>

          <div className="mt-2 space-y-2">
            {!canEdit ? (
              <div className="text-sm font-semibold text-slate-600">
                Only host/co-host can invite friends to the league.
              </div>
            ) : friendsLoading ? (
              <div className="text-sm font-semibold text-slate-600">Loading friends…</div>
            ) : friendsNotInLeague.length === 0 ? (
              <div className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-700 ring-1 ring-slate-200">
                No inviteable friends found.
                <div className="mt-1 text-xs font-semibold text-slate-600">
                  Tip: Add mates on the <span className="font-extrabold">Friends</span> page first, then come back here.
                </div>
              </div>
            ) : (
              friendsNotInLeague.map((p) => {
                const pid = p?.id;
                const name = p?.display_name || p?.username || "Friend";
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
                  invitee?.display_name ||
                  invitee?.username ||
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
            <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Season start</div>
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
            <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Season end (optional)</div>
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
              canEdit
                ? "bg-slate-900 text-white hover:bg-slate-800"
                : "bg-slate-200 text-slate-500 cursor-not-allowed",
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
              const role = roleForUser(uid);
              const isHost = role === LEAGUE_ROLES.host;
              const isCoHost = role === LEAGUE_ROLES.co_host;

              return (
                <div
                  key={uid}
                  className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-extrabold text-slate-900">{getUserName(u)}</div>
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
      </Card>

      {/* Danger zone */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-extrabold text-slate-900">Danger zone</div>
            <div className="mt-1 text-xs font-semibold text-slate-600">
              If something is broken, the Host can delete the league and start again.
            </div>
          </div>

          <span className="rounded-full bg-slate-100 px-3 py-2 text-xs font-extrabold text-slate-700 ring-1 ring-slate-200">
            Host only
          </span>
        </div>

        <div className="mt-4 space-y-3">
          <div className="rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-900 ring-1 ring-rose-200">
            Deleting a league removes league members, invites, and rounds (best-effort).
          </div>

          <div>
            <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
              Type DELETE to confirm
            </div>
            <input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="DELETE"
              disabled={deleteBusy || effectiveRole !== LEAGUE_ROLES.host}
              className={[
                "mt-2 w-full rounded-xl border px-3 py-2 text-sm font-extrabold outline-none ring-rose-200 focus:ring-4",
                deleteBusy || effectiveRole !== LEAGUE_ROLES.host
                  ? "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed"
                  : "border-slate-200 bg-white text-slate-900",
              ].join(" ")}
            />
          </div>

          <button
            type="button"
            onClick={deleteLeagueNow}
            disabled={deleteBusy || effectiveRole !== LEAGUE_ROLES.host}
            className={[
              "rounded-xl px-4 py-2 text-sm font-extrabold",
              deleteBusy || effectiveRole !== LEAGUE_ROLES.host
                ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                : "bg-rose-600 text-white hover:bg-rose-500",
            ].join(" ")}
          >
            {deleteBusy ? "Deleting…" : "Delete league"}
          </button>
        </div>
      </Card>
    </div>
  );
}








