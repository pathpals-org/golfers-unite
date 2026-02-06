// src/pages/LeagueSettings.jsx
import { useEffect, useMemo, useState } from "react";
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
  isLeagueAdmin,
  getLeagueRole,
  setLeagueRole,
  LEAGUE_ROLES,
  syncActiveLeagueFromSupabase,
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
  // store as ISO string at midnight local-ish; good enough for MVP localStorage
  const d = new Date(dateStr + "T00:00:00");
  return d.toISOString();
}

function getUserId(u) {
  return u?.id || u?._id || null;
}

function getUserName(u) {
  return u?.name || u?.fullName || u?.displayName || u?.username || "Golfer";
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

function normalizeEmail(v) {
  return String(v || "").trim().toLowerCase();
}

function isValidEmail(v) {
  const s = normalizeEmail(v);
  // simple MVP-safe check
  return s.length >= 5 && s.includes("@") && s.includes(".");
}

function humanizeSupabaseError(err) {
  const msg = err?.message || String(err || "");
  if (!msg) return "Something went wrong.";
  return msg;
}

export default function LeagueSettings() {
  const navigate = useNavigate();
  const location = useLocation();

  const [league, setLeagueState] = useState(() => getLeagueSafe({}));
  const [users, setUsersState] = useState(() => ensureArr(getUsers([])));

  // ✅ Real auth user (Supabase)
  const [authUserId, setAuthUserId] = useState(null);

  // Invite UI
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteStatus, setInviteStatus] = useState({ type: "", message: "" });
  const [inviteLoading, setInviteLoading] = useState(false);

  // points system
  const pointsSystem = useMemo(() => getPointsSystem(null), [league?.pointsSystem]);

  // points draft (edit then save)
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

  // ✅ Resolve current user from Supabase session
  useEffect(() => {
    let alive = true;

    async function loadAuthUser() {
      try {
        const { data } = await supabase.auth.getUser();
        const uid = data?.user?.id || null;
        if (!alive) return;
        setAuthUserId(uid);
      } catch {
        if (!alive) return;
        setAuthUserId(null);
      }
    }

    loadAuthUser();

    return () => {
      alive = false;
    };
  }, []);

  // ✅ Keep local cache in sync on navigation
  useEffect(() => {
    // resync on navigation
    setLeagueState(getLeagueSafe({}));
    setUsersState(ensureArr(getUsers([])));

    const l = getLeagueSafe({});
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
  }, [location.key]);

  // ✅ Current user = auth user if possible, otherwise fallback to first cached user
  const me = useMemo(() => {
    if (authUserId) return users.find((u) => getUserId(u) === authUserId) || null;
    return users?.[0] || null;
  }, [authUserId, users]);

  const myId = authUserId || getUserId(me);
  const myRole = getLeagueRole(myId);
  const iAmAdmin = isLeagueAdmin(myId);

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

  // If you’re not admin, you can still view, but editing is disabled
  const canEdit = Boolean(iAmAdmin);

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

    // Prevent demoting yourself if you're the only admin? We'll keep MVP simple here.
    setLeagueRole(userId, makeCoHost ? LEAGUE_ROLES.co_host : LEAGUE_ROLES.member);
    setLeagueState(getLeagueSafe({}));
  }

  async function inviteToLeague() {
    if (!canEdit) return;

    const email = normalizeEmail(inviteEmail);
    if (!isValidEmail(email)) {
      setInviteStatus({ type: "error", message: "Enter a valid email address." });
      return;
    }

    if (!league?.id) {
      setInviteStatus({ type: "error", message: "No active league loaded." });
      return;
    }

    setInviteLoading(true);
    setInviteStatus({ type: "", message: "" });

    try {
      // 1) Find profile by email
      const { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select("id,email,display_name")
        .eq("email", email)
        .maybeSingle();

      if (profErr) throw profErr;

      if (!prof?.id) {
        setInviteStatus({
          type: "info",
          message: "That golfer hasn’t signed up yet. Ask them to create an account first, then invite again.",
        });
        setInviteLoading(false);
        return;
      }

      const userId = prof.id;

      // 2) Add as a member (idempotent-ish)
      const { error: insErr } = await supabase.from("league_members").insert({
        league_id: league.id,
        user_id: userId,
        role: "member",
      });

      if (insErr) {
        // unique violation -> already in league
        if (String(insErr.code) === "23505") {
          setInviteStatus({ type: "info", message: "They’re already in this league." });
          setInviteLoading(false);
          return;
        }
        throw insErr;
      }

      // 3) Refresh local cache for UI
      await syncActiveLeagueFromSupabase({ leagueId: league.id });

      // 4) Re-sync page state from cache
      setLeagueState(getLeagueSafe({}));
      setUsersState(ensureArr(getUsers([])));

      setInviteEmail("");
      setInviteStatus({ type: "success", message: "Invite added — they’re now in the league ✅" });
    } catch (e) {
      setInviteStatus({ type: "error", message: humanizeSupabaseError(e) });
    } finally {
      setInviteLoading(false);
    }
  }

  const placementRows = placementRowsFromMap(pointsDraft.placementPoints);

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
              Logged in as <span className="font-extrabold">{getUserName(me)}</span> ·{" "}
              <span className="font-extrabold">{roleLabel(myRole)}</span>
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
      </Card>

      {/* ✅ Invite golfers */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-extrabold text-slate-900">Invite golfers</div>
            <div className="mt-1 text-xs font-semibold text-slate-600">
              Add your mates by email. They must have signed up first.
            </div>
          </div>

          <span className="rounded-full bg-slate-100 px-3 py-2 text-xs font-extrabold text-slate-700 ring-1 ring-slate-200">
            League ID: <span className="font-mono">{String(league.id).slice(0, 8)}…</span>
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Email</div>
            <input
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="friend@email.com"
              inputMode="email"
              disabled={!canEdit || inviteLoading}
              className={[
                "mt-2 w-full rounded-xl border px-3 py-2 text-sm font-extrabold outline-none ring-emerald-200 focus:ring-4",
                !canEdit || inviteLoading
                  ? "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed"
                  : "border-slate-200 bg-white text-slate-900",
              ].join(" ")}
            />
          </div>

          <button
            type="button"
            onClick={inviteToLeague}
            disabled={!canEdit || inviteLoading || !isValidEmail(inviteEmail)}
            className={[
              "rounded-xl px-4 py-2 text-sm font-extrabold",
              !canEdit || inviteLoading || !isValidEmail(inviteEmail)
                ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                : "bg-slate-900 text-white hover:bg-slate-800",
            ].join(" ")}
          >
            {inviteLoading ? "Inviting…" : "Invite"}
          </button>
        </div>

        {inviteStatus?.message ? (
          <div
            className={[
              "mt-3 rounded-2xl px-4 py-3 text-sm font-semibold ring-1",
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
                canEdit ? "bg-white text-slate-900 ring-slate-200 hover:bg-slate-50" : "bg-slate-50 text-slate-400 ring-slate-200 cursor-not-allowed",
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
                canEdit ? "bg-white text-slate-900 ring-slate-200 hover:bg-slate-50" : "bg-slate-50 text-slate-400 ring-slate-200 cursor-not-allowed",
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
                canEdit ? "bg-white text-slate-900 ring-slate-200 hover:bg-slate-50" : "bg-slate-50 text-slate-400 ring-slate-200 cursor-not-allowed",
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
                canEdit ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-slate-200 text-slate-500 cursor-not-allowed",
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
          This now uses the signed-in Supabase account for permissions.
        </div>
      </Card>
    </div>
  );
}

