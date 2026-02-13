// src/pages/League.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import EmptyState from "../components/ui/EmptyState";
import Card from "../components/ui/Card";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/useAuth";

import {
  // ✅ UI cache reads
  getLeagueSafe,
  getUsers,
  getRounds,
  getTrophies,

  // ✅ UI cache writes (demo/offline trophies/archives still local for now)
  setTrophies,
  addSeasonArchive,

  // ✅ Supabase-first storage layer
  syncActiveLeagueFromSupabase,
  setActiveLeagueId,
  getPointsSystem,
  setPointsSystemSupabase,
  resolveLeagueIdSupabaseFirst,
} from "../utils/storage";

import { buildStandings } from "../utils/stats";

const DEFAULT_POINTS_SYSTEM = {
  placementPoints: { 1: 3, 2: 2, 3: 0 },
  participation: { enabled: false, points: 1 },
  bonuses: {
    enabled: false,
    birdie: { enabled: false, points: 1 },
    eagle: { enabled: false, points: 2 },
    hio: { enabled: false, points: 5 },
  },
};

function cleanLeagueId(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const low = s.toLowerCase();
  if (low === "undefined" || low === "null") return null;
  return s;
}

function formatSeasonRange(startISO) {
  if (!startISO) return "";
  const start = new Date(startISO);
  const end = new Date(startISO);
  end.setFullYear(end.getFullYear() + 1);
  end.setDate(end.getDate() - 1);

  const fmt = (d) => d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

function getWeekNumber(seasonStartISO) {
  if (!seasonStartISO) return 1;
  const start = new Date(seasonStartISO);
  const now = new Date();
  const diff = Math.max(0, now.getTime() - start.getTime());
  const days = diff / (1000 * 60 * 60 * 24);
  return Math.max(1, Math.floor(days / 7) + 1);
}

function Modal({ open, title, children, onClose }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="absolute left-1/2 top-1/2 w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2">
        <div className="rounded-2xl bg-white p-5 shadow-xl ring-1 ring-slate-200">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-base font-extrabold text-slate-900">{title}</div>
              <div className="mt-1 text-xs font-semibold text-slate-500">Supabase-backed.</div>
            </div>
            <button
              onClick={onClose}
              className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-extrabold text-slate-900 hover:bg-slate-200"
            >
              Close
            </button>
          </div>
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

function Toast({ message, onClose }) {
  if (!message) return null;
  return (
    <div className="fixed bottom-24 left-1/2 z-[70] w-[92vw] max-w-md -translate-x-1/2">
      <div className="rounded-2xl bg-slate-900 p-4 text-sm shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div className="text-white">{message}</div>
          <button
            onClick={onClose}
            className="rounded-lg bg-white/10 px-2 py-1 text-xs font-extrabold text-white hover:bg-white/15"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

function Crest() {
  return (
    <div className="grid h-10 w-10 place-items-center rounded-2xl bg-slate-900 text-lg text-white shadow-sm">
      🏆
    </div>
  );
}

function PosPill({ pos }) {
  const isLeader = pos === 1;
  return (
    <div
      className={[
        "inline-flex h-7 w-9 items-center justify-center rounded-lg text-xs font-extrabold text-white",
        isLeader ? "bg-amber-500" : "bg-slate-700",
      ].join(" ")}
      title={isLeader ? "Leader" : `Position ${pos}`}
    >
      {pos}
    </div>
  );
}

function safeNum(n, fallback = 0) {
  const x = typeof n === "string" ? Number(n) : n;
  return Number.isFinite(x) ? x : fallback;
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

function placementToLabel(map) {
  const m = normalizePlacement(map);
  const places = Object.keys(m)
    .map((k) => Number(k))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  if (!places.length) return "Not set";

  return places
    .map((p) => `${p}${p === 1 ? "st" : p === 2 ? "nd" : p === 3 ? "rd" : "th"}=${m[p]}`)
    .join(", ");
}

function mergePointsSystem(raw) {
  const base = DEFAULT_POINTS_SYSTEM;
  const ps = raw && typeof raw === "object" ? raw : {};

  const placementPoints = normalizePlacement(ps.placementPoints || base.placementPoints);

  const participation = ps.participation && typeof ps.participation === "object" ? ps.participation : {};
  const bonuses = ps.bonuses && typeof ps.bonuses === "object" ? ps.bonuses : {};

  const birdie = bonuses.birdie && typeof bonuses.birdie === "object" ? bonuses.birdie : {};
  const eagle = bonuses.eagle && typeof bonuses.eagle === "object" ? bonuses.eagle : {};
  const hio = bonuses.hio && typeof bonuses.hio === "object" ? bonuses.hio : {};

  return {
    placementPoints: Object.keys(placementPoints).length ? placementPoints : base.placementPoints,
    participation: {
      enabled: Boolean(participation.enabled ?? base.participation.enabled),
      points: Math.trunc(safeNum(participation.points, base.participation.points)),
    },
    bonuses: {
      enabled: Boolean(bonuses.enabled ?? base.bonuses.enabled),
      birdie: {
        enabled: Boolean(birdie.enabled ?? base.bonuses.birdie.enabled),
        points: Math.trunc(safeNum(birdie.points, base.bonuses.birdie.points)),
      },
      eagle: {
        enabled: Boolean(eagle.enabled ?? base.bonuses.eagle.enabled),
        points: Math.trunc(safeNum(eagle.points, base.bonuses.eagle.points)),
      },
      hio: {
        enabled: Boolean(hio.enabled ?? base.bonuses.hio.enabled),
        points: Math.trunc(safeNum(hio.points, base.bonuses.hio.points)),
      },
    },
  };
}

function humanizeSupabaseError(err) {
  const msg = err?.message || String(err || "");
  if (!msg) return "Something went wrong.";
  return msg;
}

async function insertLeagueRobust({ name, userId }) {
  const attempts = [{ name, host_user_id: userId }, { name }];

  let lastErr = null;

  for (const payload of attempts) {
    // eslint-disable-next-line no-await-in-loop
    const res = await supabase.from("leagues").insert(payload).select("*").single();
    if (!res.error && res.data) return res.data;
    lastErr = res.error;
    const msg = String(res.error?.message || "").toLowerCase();

    if (msg.includes("column") && msg.includes("does not exist")) continue;
    if (msg.includes("null value") && msg.includes("violates")) continue;

    break;
  }

  throw lastErr || new Error("Failed to create league.");
}

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

/** ✅ Single source of truth for button actions: always returns the best available leagueId. */
function resolveBestLeagueId({ league, stableLeagueIdRef }) {
  return (
    cleanLeagueId(league?.id) ||
    cleanLeagueId(stableLeagueIdRef?.current) ||
    cleanLeagueId(getLeagueSafe(null)?.id) ||
    null
  );
}

export default function League() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading: authLoading } = useAuth();

  const [league, setLeagueState] = useState(() => getLeagueSafe(null));
  const [users, setUsersState] = useState(() => getUsers([]));
  const [rounds, setRoundsState] = useState(() => getRounds([]));

  const [toast, setToast] = useState("");
  const [showEndSeason, setShowEndSeason] = useState(false);

  const [leagueLoading, setLeagueLoading] = useState(false);
  const [leagueSyncError, setLeagueSyncError] = useState("");

  // Create League modal
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createErr, setCreateErr] = useState("");

  // ✅ Stable league id for this screen (survives refresh/new tab)
  const stableLeagueIdRef = useRef(null);

  // Freeze leagueId ASAP from nav state / query
  useEffect(() => {
    const navLeagueId = cleanLeagueId(getLeagueIdFromLocation(location));
    if (navLeagueId) stableLeagueIdRef.current = navLeagueId;
  }, [location]);

  const pointsSystem = useMemo(() => {
    return mergePointsSystem(getPointsSystem(DEFAULT_POINTS_SYSTEM));
  }, [league?.pointsSystem]);

  useEffect(() => {
    let alive = true;

    async function syncLeague() {
      if (authLoading) return;
      setLeagueLoading(true);
      setLeagueSyncError("");

      try {
        const preferredRaw =
          getLeagueIdFromLocation(location) ||
          stableLeagueIdRef.current ||
          (getLeagueSafe(null)?.id ?? null);

        const preferred = cleanLeagueId(preferredRaw);

        const resolved = await resolveLeagueIdSupabaseFirst({
          preferredLeagueId: preferred,
        });

        const resolvedClean = cleanLeagueId(resolved);
        if (resolvedClean) stableLeagueIdRef.current = resolvedClean;

        await syncActiveLeagueFromSupabase({
          leagueId: resolvedClean || null,
          withRounds: true,
        });
      } catch (e) {
        const msg = String(e?.message || "");
        if (alive && msg) setLeagueSyncError(msg);
      } finally {
        if (!alive) return;
        setLeagueState(getLeagueSafe(null));
        setUsersState(getUsers([]));
        setRoundsState(getRounds([]));
        setLeagueLoading(false);
      }
    }

    syncLeague();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id, location.key]);

  useEffect(() => {
    let alive = true;

    async function ensurePointsSystem() {
      if (!league?.id) return;

      if (!league?.pointsSystem) {
        const merged = mergePointsSystem(DEFAULT_POINTS_SYSTEM);
        try {
          await setPointsSystemSupabase({ leagueId: league.id, pointsSystem: merged });
          await syncActiveLeagueFromSupabase({ leagueId: league.id, withRounds: false });
          if (!alive) return;
          setLeagueState(getLeagueSafe(null));
        } catch {
          // fail-soft
        }
      }
    }

    ensurePointsSystem();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league?.id]);

  const leagueRounds = useMemo(() => {
    if (!league?.id) return [];
    return rounds.filter((r) => {
      const lid = r?.league_id || r?.leagueId || null;
      if (!lid) return false;
      return String(lid) === String(league.id);
    });
  }, [league?.id, rounds]);

  const standings = useMemo(() => {
    if (!league) return [];
    const members = Array.isArray(league?.members) ? league.members : [];
    const memberUsers = users.filter((u) => members.includes(u.id || u._id));
    return buildStandings(memberUsers, leagueRounds, pointsSystem);
  }, [league, users, leagueRounds, pointsSystem]);

  async function handleCreateLeague() {
    if (!user?.id) {
      setCreateErr("You must be signed in to create a league.");
      return;
    }

    const name = String(createName || "").trim();
    if (name.length < 2) {
      setCreateErr("League name must be at least 2 characters.");
      return;
    }

    setCreateBusy(true);
    setCreateErr("");

    try {
      const leagueRow = await insertLeagueRobust({ name, userId: user.id });

      const leagueId = cleanLeagueId(leagueRow?.id);
      if (!leagueId) throw new Error("League created but id missing.");

      const { error: memErr } = await supabase.from("league_members").insert({
        league_id: leagueId,
        user_id: user.id,
        role: "host",
      });
      if (memErr) throw memErr;

      stableLeagueIdRef.current = String(leagueId);
      await setActiveLeagueId(leagueId);
      await syncActiveLeagueFromSupabase({ leagueId, withRounds: true });

      setLeagueState(getLeagueSafe(null));
      setUsersState(getUsers([]));
      setRoundsState(getRounds([]));

      setShowCreate(false);
      setCreateName("");
      setToast("League created ✅ You’re Host.");
    } catch (e) {
      setCreateErr(humanizeSupabaseError(e));
    } finally {
      setCreateBusy(false);
    }
  }

  if (!league) {
    return (
      <div className="pt-2 space-y-3">
        <EmptyState
          icon="🏌️"
          title={leagueLoading ? "Loading your league…" : "No league yet"}
          description={
            leagueLoading
              ? "Checking your league membership…"
              : "Create a league (or accept an invite) to unlock standings and settings."
          }
          actions={
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => navigate("/friends")}
                className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-extrabold text-slate-900 hover:bg-slate-200"
              >
                Find golfers
              </button>

              <button
                onClick={() => navigate("/profile")}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-extrabold text-white hover:bg-slate-800"
              >
                Go to Profile
              </button>

              <button
                onClick={() => setShowCreate(true)}
                disabled={!user?.id || leagueLoading}
                className={[
                  "rounded-xl px-4 py-2 text-sm font-extrabold",
                  !user?.id || leagueLoading
                    ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                    : "bg-emerald-600 text-white hover:bg-emerald-500",
                ].join(" ")}
              >
                + Create League
              </button>
            </div>
          }
        />

        {leagueSyncError ? (
          <div className="rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-900 ring-1 ring-rose-200">
            {leagueSyncError}
          </div>
        ) : null}

        <Modal open={showCreate} title="Create a league" onClose={() => setShowCreate(false)}>
          <div className="space-y-3">
            <div className="text-sm font-semibold text-slate-700">
              You’ll become <span className="font-extrabold">Host</span> automatically.
            </div>

            <div>
              <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                League name
              </div>
              <input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="e.g. Sunday Society"
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-extrabold text-slate-900 outline-none ring-emerald-200 focus:ring-4"
              />
            </div>

            {createErr ? (
              <div className="rounded-2xl bg-rose-50 p-3 text-sm font-semibold text-rose-900 ring-1 ring-rose-200">
                {createErr}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleCreateLeague}
                disabled={createBusy}
                className={[
                  "rounded-xl px-4 py-2 text-sm font-extrabold",
                  createBusy
                    ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                    : "bg-slate-900 text-white hover:bg-slate-800",
                ].join(" ")}
              >
                {createBusy ? "Creating…" : "Create league"}
              </button>

              <button
                onClick={() => setShowCreate(false)}
                className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-extrabold text-slate-900 hover:bg-slate-200"
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      </div>
    );
  }

  function goToPlayer(userId) {
    navigate(`/profile?userId=${encodeURIComponent(userId)}`);
  }

  function endSeasonConfirm() {
    const trophies = getTrophies([]);

    const champion = standings[0];
    const mostBirdies = standings.slice().sort((a, b) => b.birdies - a.birdies)[0];
    const mostEagles = standings.slice().sort((a, b) => b.eagles - a.eagles)[0];
    const mostMajors = standings.slice().sort((a, b) => b.majors - a.majors)[0];

    const endedAtISO = new Date().toISOString();
    const seasonLabel = formatSeasonRange(league.seasonStartISO);

    const awards = [
      champion
        ? {
            type: "LEAGUE_CHAMPION",
            title: "League Champion 🏆",
            userId: champion.userId,
            meta: { seasonLabel, points: champion.points },
          }
        : null,
      mostBirdies
        ? {
            type: "MOST_BIRDIES",
            title: "Most Birdies 🐦",
            userId: mostBirdies.userId,
            meta: { seasonLabel, birdies: mostBirdies.birdies },
          }
        : null,
      mostEagles
        ? {
            type: "MOST_EAGLES",
            title: "Most Eagles 🦅",
            userId: mostEagles.userId,
            meta: { seasonLabel, eagles: mostEagles.eagles },
          }
        : null,
      mostMajors
        ? {
            type: "MAJOR_HOUND",
            title: "Major Hound ⭐",
            userId: mostMajors.userId,
            meta: { seasonLabel, majors: mostMajors.majors },
          }
        : null,
    ].filter(Boolean);

    const newTrophies = awards.map((a) => ({
      id: crypto.randomUUID(),
      userId: a.userId,
      type: a.type,
      title: a.title,
      dateISO: endedAtISO,
      leagueId: league.id,
      meta: a.meta,
    }));

    addSeasonArchive({
      id: crypto.randomUUID(),
      leagueId: league.id,
      seasonLabel,
      endedAtISO,
      standingsSnapshot: standings,
      awardsSnapshot: newTrophies,
    });

    setTrophies([...(newTrophies || []), ...(trophies || [])]);

    const nextLeague = { ...league, seasonStartISO: endedAtISO };

    // keep active pinned (ONLY if valid)
    const lidPinned = cleanLeagueId(league?.id);
    if (lidPinned) {
      // eslint-disable-next-line no-void
      void setActiveLeagueId(lidPinned);
    }

    const remaining = rounds.filter((r) => {
      const rid = r?.league_id || r?.leagueId || null;
      return String(rid || "") !== String(league.id);
    });
    setRoundsState(remaining);

    setShowEndSeason(false);
    setToast("Season ended — trophies awarded + standings archived 🏆");

    // eslint-disable-next-line no-void
    void (async () => {
      try {
        await syncActiveLeagueFromSupabase({ leagueId: league.id, withRounds: false });
      } catch {
        // ignore
      }
      setLeagueState({ ...getLeagueSafe(null), ...nextLeague });
    })();
  }

  const seasonRange = formatSeasonRange(league.seasonStartISO);
  const week = getWeekNumber(league.seasonStartISO);
  const placementSummary = placementToLabel(pointsSystem?.placementPoints);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-3">
          <Crest />
          <div className="min-w-0">
            <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
              League
            </div>
            <div className="truncate text-xl font-extrabold text-slate-900">{league.name}</div>
            <div className="mt-1 text-sm font-semibold text-slate-600">{seasonRange}</div>

            <div className="mt-2 text-xs font-semibold text-slate-500">
              Points:{" "}
              <span className="font-extrabold text-slate-700">{placementSummary}</span>
              {pointsSystem?.participation?.enabled ? (
                <span className="ml-2 rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-extrabold text-slate-700 ring-1 ring-slate-200">
                  +{pointsSystem.participation.points} play
                </span>
              ) : null}
              {pointsSystem?.bonuses?.enabled ? (
                <span className="ml-2 rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-extrabold text-slate-700 ring-1 ring-slate-200">
                  Bonuses on
                </span>
              ) : null}
            </div>

            <div className="mt-1 text-[11px] font-semibold text-slate-500">
              League admins can edit points in{" "}
              <span className="font-extrabold text-slate-700">League Settings</span>.
            </div>

            {leagueLoading ? (
              <div className="mt-2 text-[11px] font-semibold text-slate-400">
                Syncing league…
              </div>
            ) : null}
          </div>

          <div className="ml-auto text-right">
            <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Week</div>
            <div className="text-2xl font-extrabold text-emerald-700">
              {String(week).padStart(2, "0")}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={() => navigate("/post")}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-extrabold text-white hover:bg-slate-800"
          >
            + Submit Round
          </button>

          <button
            onClick={() => {
              const lid = resolveBestLeagueId({ league, stableLeagueIdRef });
              if (!lid) {
                setToast("League not ready yet — try again in a second.");
                return;
              }
              // eslint-disable-next-line no-void
              void setActiveLeagueId(lid);
              navigate("/?scope=league");
            }}
            className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-extrabold text-slate-900 hover:bg-slate-200"
            title="Opens the feed filtered to League banter"
          >
            League Banter →
          </button>

          <button
            onClick={() => {
              const lid = resolveBestLeagueId({ league, stableLeagueIdRef });
              if (!lid) {
                setToast("League not ready yet — try again in a second.");
                return;
              }

              // Keep it pinned for settings + any other screens.
              // eslint-disable-next-line no-void
              void setActiveLeagueId(lid);

              const url = `/league-settings?leagueId=${encodeURIComponent(lid)}`;
              navigate(url, { state: { leagueId: lid } });
            }}
            className="ml-auto rounded-xl bg-white px-4 py-2 text-sm font-extrabold text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50"
          >
            League Settings
          </button>
        </div>
      </Card>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2">
          <div className="grid grid-cols-[56px_1fr_44px_44px_44px_44px_70px] items-center gap-2 text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
            <div>Pos</div>
            <div>Player</div>
            <div className="text-center">R</div>
            <div className="text-center">B</div>
            <div className="text-center">E</div>
            <div className="text-center">H</div>
            <div className="text-right">Pts</div>
          </div>
        </div>

        {standings.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon="📋"
              title="No rounds yet"
              description="Submit the first round to populate the league table."
            />
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {standings.map((row, idx) => {
              const pos = idx + 1;
              return (
                <button
                  key={row.userId}
                  onClick={() => goToPlayer(row.userId)}
                  className="w-full px-4 py-3 text-left transition hover:bg-emerald-50 active:scale-[0.999]"
                  title="Tap to view profile"
                >
                  <div className="grid grid-cols-[56px_1fr_44px_44px_44px_44px_70px] items-center gap-2">
                    <div className="flex items-center">
                      <PosPill pos={pos} />
                    </div>

                    <div className="min-w-0">
                      <div className="truncate text-sm font-extrabold text-slate-900">{row.name}</div>
                      <div className="mt-0.5 text-[11px] font-semibold text-slate-500">
                        ⭐ {row.majors} majors
                      </div>
                    </div>

                    <div className="text-center text-sm font-extrabold text-slate-900">{row.rounds}</div>
                    <div className="text-center text-sm font-extrabold text-slate-900">{row.birdies}</div>
                    <div className="text-center text-sm font-extrabold text-slate-900">{row.eagles}</div>
                    <div className="text-center text-sm font-extrabold text-slate-900">{row.hio}</div>

                    <div className="text-right">
                      <div className="text-base font-extrabold text-slate-900">{row.points}</div>
                      <div className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">pts</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-white px-4 py-3">
          <div className="text-xs font-semibold text-slate-600">{leagueRounds.length} rounds played</div>
          <button
            onClick={() => setShowEndSeason(true)}
            className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-extrabold text-white hover:bg-rose-500"
          >
            End Season
          </button>
        </div>
      </div>

      <Modal open={showEndSeason} title="End season?" onClose={() => setShowEndSeason(false)}>
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <div className="font-extrabold text-slate-900">What happens:</div>
            <ul className="mt-2 list-disc space-y-1 pl-5 font-semibold">
              <li>League Champion trophy awarded to #1 in points.</li>
              <li>Season awards: Most Birdies / Most Eagles / Major Hound.</li>
              <li>Standings snapshot archived to seasonArchives.</li>
              <li>Rounds cleared for a fresh season start (demo flow).</li>
            </ul>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={endSeasonConfirm}
              className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-rose-500"
            >
              Confirm End Season
            </button>
            <button
              onClick={() => setShowEndSeason(false)}
              className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-extrabold text-slate-900 hover:bg-slate-200"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      <Toast message={toast} onClose={() => setToast("")} />
    </div>
  );
}




