// src/pages/League.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import EmptyState from "../components/ui/EmptyState";
import Card from "../components/ui/Card";
import {
  getLeague,
  setLeague,
  getUsers,
  getRounds,
  setRounds,
  getTrophies,
  setTrophies,
  addSeasonArchive,
  getPointsSystem,
  setPointsSystem,
} from "../utils/storage";
import { buildStandings } from "../utils/stats";

const DEFAULT_POINTS_SYSTEM = {
  // Placement table: places not listed = 0 points
  placementPoints: { 1: 3, 2: 2, 3: 0 },

  // Optional “just for playing” point
  participation: { enabled: false, points: 1 },

  // Optional bonuses (simple toggles)
  bonuses: {
    enabled: false,
    birdie: { enabled: false, points: 1 },
    eagle: { enabled: false, points: 2 },
    hio: { enabled: false, points: 5 },
  },
};

function formatSeasonRange(startISO) {
  if (!startISO) return "";
  const start = new Date(startISO);
  const end = new Date(startISO);
  end.setFullYear(end.getFullYear() + 1);
  end.setDate(end.getDate() - 1);

  const fmt = (d) =>
    d.toLocaleDateString(undefined, { month: "short", year: "numeric" });

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
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="absolute left-1/2 top-1/2 w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2">
        <div className="rounded-2xl bg-white p-5 shadow-xl ring-1 ring-slate-200">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-base font-extrabold text-slate-900">
                {title}
              </div>
              <div className="mt-1 text-xs font-semibold text-slate-500">
                Front-end only (localStorage).
              </div>
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
    .map(
      (p) =>
        `${p}${
          p === 1 ? "st" : p === 2 ? "nd" : p === 3 ? "rd" : "th"
        }=${m[p]}`
    )
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

export default function League() {
  const navigate = useNavigate();
  const location = useLocation();

  const [league, setLeagueState] = useState(() => getLeague(null));
  const [users, setUsersState] = useState(() => getUsers([]));
  const [rounds, setRoundsState] = useState(() => getRounds([]));

  const [toast, setToast] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [showEndSeason, setShowEndSeason] = useState(false);
  const [showPoints, setShowPoints] = useState(false);

  const pointsSystem = useMemo(() => {
    return mergePointsSystem(getPointsSystem(DEFAULT_POINTS_SYSTEM));
  }, [league?.pointsSystem]);

  // local UI state for editing points (we save on click)
  const [pointsDraft, setPointsDraft] = useState(() => {
    const ps = mergePointsSystem(getPointsSystem(DEFAULT_POINTS_SYSTEM));
    return {
      placementPoints: normalizePlacement(ps.placementPoints),
      participationEnabled: Boolean(ps.participation.enabled),
      participationPoints: safeNum(ps.participation.points, 1),

      bonusesEnabled: Boolean(ps.bonuses.enabled),
      birdieEnabled: Boolean(ps.bonuses.birdie.enabled),
      birdiePoints: safeNum(ps.bonuses.birdie.points, 1),
      eagleEnabled: Boolean(ps.bonuses.eagle.enabled),
      eaglePoints: safeNum(ps.bonuses.eagle.points, 2),
      hioEnabled: Boolean(ps.bonuses.hio.enabled),
      hioPoints: safeNum(ps.bonuses.hio.points, 5),
    };
  });

  useEffect(() => {
    setLeagueState(getLeague(null));
    setUsersState(getUsers([]));
    setRoundsState(getRounds([]));

    // refresh points draft when navigating back here
    const ps = mergePointsSystem(getPointsSystem(DEFAULT_POINTS_SYSTEM));
    setPointsDraft({
      placementPoints: normalizePlacement(ps.placementPoints),
      participationEnabled: Boolean(ps.participation.enabled),
      participationPoints: safeNum(ps.participation.points, 1),

      bonusesEnabled: Boolean(ps.bonuses.enabled),
      birdieEnabled: Boolean(ps.bonuses.birdie.enabled),
      birdiePoints: safeNum(ps.bonuses.birdie.points, 1),
      eagleEnabled: Boolean(ps.bonuses.eagle.enabled),
      eaglePoints: safeNum(ps.bonuses.eagle.points, 2),
      hioEnabled: Boolean(ps.bonuses.hio.enabled),
      hioPoints: safeNum(ps.bonuses.hio.points, 5),
    });
  }, [location.pathname]);

  // Ensure league has a pointsSystem once we have a league (safe default)
  useEffect(() => {
    if (!league) return;
    if (!league?.pointsSystem) {
      const merged = mergePointsSystem(DEFAULT_POINTS_SYSTEM);
      setPointsSystem(merged);

      const nextLeague = { ...league, pointsSystem: merged };
      setLeague(nextLeague);
      setLeagueState(nextLeague);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league?.id]);

  const leagueRounds = useMemo(() => {
    if (!league?.id) return [];
    return rounds.filter((r) => !r?.leagueId || r?.leagueId === league.id);
  }, [league?.id, rounds]);

  const standings = useMemo(() => {
    if (!league) return [];
    const members = Array.isArray(league?.members) ? league.members : [];
    const memberUsers = users.filter((u) => members.includes(u.id || u._id));

    // IMPORTANT: pass points rules so standings can recompute if needed
    return buildStandings(memberUsers, leagueRounds, pointsSystem);
  }, [league, users, leagueRounds, pointsSystem]);

  if (!league) {
    return (
      <div className="pt-2">
        <EmptyState
          icon="🏌️"
          title="No league yet"
          description="Seed data should create a demo league automatically. If not, refresh or clear localStorage and reload."
        />
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
    setLeague(nextLeague);
    setLeagueState(nextLeague);

    const remaining = rounds.filter((r) => r?.leagueId && r?.leagueId !== league.id);
    setRounds(remaining);
    setRoundsState(remaining);

    setShowEndSeason(false);
    setToast("Season ended — trophies awarded + standings archived 🏆");
  }

  function applyPointsSettings() {
    const placementPoints = normalizePlacement(pointsDraft.placementPoints);
    const safePlacement =
      Object.keys(placementPoints).length > 0
        ? placementPoints
        : DEFAULT_POINTS_SYSTEM.placementPoints;

    const merged = mergePointsSystem({
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
    });

    // Persist to league.pointsSystem via storage helper
    setPointsSystem(merged);

    const nextLeague = { ...league, pointsSystem: merged };
    setLeague(nextLeague);
    setLeagueState(nextLeague);

    setShowPoints(false);
    setToast("Points settings saved ✅");
  }

  function setPreset(preset) {
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
    const p = Math.trunc(safeNum(place, NaN));
    if (!Number.isFinite(p) || p <= 0) return;
    const v = Math.trunc(safeNum(value, 0));
    setPointsDraft((d) => ({
      ...d,
      placementPoints: { ...(d.placementPoints || {}), [p]: v },
    }));
  }

  function removePlacement(place) {
    const p = Math.trunc(safeNum(place, NaN));
    if (!Number.isFinite(p) || p <= 0) return;
    setPointsDraft((d) => {
      const next = { ...(d.placementPoints || {}) };
      delete next[p];
      return { ...d, placementPoints: next };
    });
  }

  function addPlacementRow() {
    setPointsDraft((d) => {
      const cur = normalizePlacement(d.placementPoints);
      const existingPlaces = Object.keys(cur).map((k) => Number(k));
      const nextPlace = existingPlaces.length ? Math.max(...existingPlaces) + 1 : 4;
      return { ...d, placementPoints: { ...cur, [nextPlace]: 0 } };
    });
  }

  const seasonRange = formatSeasonRange(league.seasonStartISO);
  const week = getWeekNumber(league.seasonStartISO);

  const placementSummary = placementToLabel(pointsSystem?.placementPoints);

  const placementRows = Object.keys(normalizePlacement(pointsDraft.placementPoints))
    .map((k) => Number(k))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  return (
    <div className="space-y-4">
      {/* Header card */}
      <Card>
        <div className="flex items-center gap-3">
          <Crest />
          <div className="min-w-0">
            <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
              League
            </div>
            <div className="truncate text-xl font-extrabold text-slate-900">
              {league.name}
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-600">
              {seasonRange}
            </div>

            {/* Points summary */}
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
          </div>

          <div className="ml-auto text-right">
            <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
              Week
            </div>
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

          {/* go to league scope */}
          <button
            onClick={() => navigate("/?scope=league")}
            className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-extrabold text-slate-900 hover:bg-slate-200"
            title="Opens the feed filtered to League banter"
          >
            League Banter →
          </button>

          <button
            onClick={() => setShowMore(true)}
            className="ml-auto rounded-xl bg-white px-4 py-2 text-sm font-extrabold text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50"
          >
            More
          </button>
        </div>
      </Card>

      {/* Table card */}
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
                      <div className="truncate text-sm font-extrabold text-slate-900">
                        {row.name}
                      </div>
                      <div className="mt-0.5 text-[11px] font-semibold text-slate-500">
                        ⭐ {row.majors} majors
                      </div>
                    </div>

                    <div className="text-center text-sm font-extrabold text-slate-900">
                      {row.rounds}
                    </div>
                    <div className="text-center text-sm font-extrabold text-slate-900">
                      {row.birdies}
                    </div>
                    <div className="text-center text-sm font-extrabold text-slate-900">
                      {row.eagles}
                    </div>
                    <div className="text-center text-sm font-extrabold text-slate-900">
                      {row.hio}
                    </div>

                    <div className="text-right">
                      <div className="text-base font-extrabold text-slate-900">
                        {row.points}
                      </div>
                      <div className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">
                        pts
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-white px-4 py-3">
          <div className="text-xs font-semibold text-slate-600">
            {leagueRounds.length} rounds played
          </div>
          <button
            onClick={() => setShowEndSeason(true)}
            className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-extrabold text-white hover:bg-rose-500"
          >
            End Season
          </button>
        </div>
      </div>

      {/* More modal */}
      <Modal open={showMore} title="League Options" onClose={() => setShowMore(false)}>
        <div className="space-y-3">
          <button
            onClick={() => {
              setShowMore(false);
              setShowPoints(true);
            }}
            className="w-full rounded-2xl bg-slate-100 px-4 py-3 text-left text-sm font-extrabold text-slate-900 hover:bg-slate-200"
          >
            Points Settings
            <div className="mt-1 text-xs font-semibold text-slate-600">
              Choose how your league awards points.
            </div>
          </button>

          <button
            onClick={() => {
              setShowMore(false);
              navigate("/rules");
            }}
            className="w-full rounded-2xl bg-slate-100 px-4 py-3 text-left text-sm font-extrabold text-slate-900 hover:bg-slate-200"
          >
            Rules & Points
            <div className="mt-1 text-xs font-semibold text-slate-600">
              Scoring, multipliers, agreements.
            </div>
          </button>

          <button
            onClick={() => {
              setShowMore(false);
              navigate("/majors");
            }}
            className="w-full rounded-2xl bg-slate-100 px-4 py-3 text-left text-sm font-extrabold text-slate-900 hover:bg-slate-200"
          >
            Majors
            <div className="mt-1 text-xs font-semibold text-slate-600">
              Manage major days.
            </div>
          </button>

          <button
            onClick={() => {
              setShowMore(false);
              setShowEndSeason(true);
            }}
            className="w-full rounded-2xl bg-rose-600 px-4 py-3 text-left text-sm font-extrabold text-white hover:bg-rose-500"
          >
            End Season
            <div className="mt-1 text-xs font-semibold text-white/90">
              Archive standings + award trophies.
            </div>
          </button>
        </div>
      </Modal>

      {/* Points modal */}
      <Modal open={showPoints} title="Points Settings" onClose={() => setShowPoints(false)}>
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <div className="font-extrabold text-slate-900">Quick presets:</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setPreset("default")}
                className="rounded-xl bg-white px-3 py-2 text-xs font-extrabold text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50"
                title="1st=3, 2nd=2, 3rd=0"
              >
                Default (3/2/0)
              </button>
              <button
                type="button"
                onClick={() => setPreset("yourLeague")}
                className="rounded-xl bg-white px-3 py-2 text-xs font-extrabold text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50"
                title="1st=3, 2nd=1, 3rd=0"
              >
                Your League (3/1/0)
              </button>
              <button
                type="button"
                onClick={() => setPreset("winnerOnly")}
                className="rounded-xl bg-white px-3 py-2 text-xs font-extrabold text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50"
                title="Winner only"
              >
                Winner only
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
              Placement points
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200">
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
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-extrabold text-slate-900 outline-none ring-emerald-200 focus:ring-4"
                        aria-label={`Points for place ${p}`}
                      />

                      <div className="text-right">
                        <button
                          type="button"
                          onClick={() => removePlacement(p)}
                          className="rounded-xl bg-rose-600 px-3 py-2 text-xs font-extrabold text-white hover:bg-rose-500"
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
                  onClick={addPlacementRow}
                  className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-extrabold text-slate-900 hover:bg-slate-200"
                >
                  + Add place
                </button>
              </div>
            </div>

            <div className="text-xs font-semibold text-slate-500">
              Anyone outside these places gets{" "}
              <span className="font-extrabold">0</span> points.
            </div>
          </div>

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
                onClick={() =>
                  setPointsDraft((d) => ({ ...d, participationEnabled: !d.participationEnabled }))
                }
                className={[
                  "rounded-xl px-4 py-2 text-xs font-extrabold ring-1",
                  pointsDraft.participationEnabled
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
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-extrabold text-slate-900 outline-none ring-emerald-200 focus:ring-4"
                />
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-extrabold text-slate-900">Bonus points</div>
                <div className="mt-1 text-xs font-semibold text-slate-600">
                  Optional extras for the round (simple yes/no).
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setPointsDraft((d) => ({ ...d, bonusesEnabled: !d.bonusesEnabled }))
                }
                className={[
                  "rounded-xl px-4 py-2 text-xs font-extrabold ring-1",
                  pointsDraft.bonusesEnabled
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
                    onClick={() =>
                      setPointsDraft((d) => ({ ...d, birdieEnabled: !d.birdieEnabled }))
                    }
                    className={[
                      "rounded-xl px-3 py-2 text-xs font-extrabold ring-1",
                      pointsDraft.birdieEnabled
                        ? "bg-emerald-600 text-white ring-emerald-600 hover:bg-emerald-500"
                        : "bg-slate-100 text-slate-900 ring-slate-200 hover:bg-slate-200",
                    ].join(" ")}
                  >
                    {pointsDraft.birdieEnabled ? "On" : "Off"}
                  </button>
                  <input
                    value={String(pointsDraft.birdiePoints)}
                    onChange={(e) =>
                      setPointsDraft((d) => ({ ...d, birdiePoints: e.target.value }))
                    }
                    inputMode="numeric"
                    disabled={!pointsDraft.birdieEnabled}
                    className={[
                      "w-full rounded-xl border px-3 py-2 text-sm font-extrabold outline-none ring-emerald-200 focus:ring-4",
                      pointsDraft.birdieEnabled
                        ? "border-slate-200 bg-white text-slate-900"
                        : "border-slate-200 bg-slate-50 text-slate-400",
                    ].join(" ")}
                  />
                </div>

                {/* Eagle */}
                <div className="grid grid-cols-[1fr_70px_120px] items-center gap-2">
                  <div className="text-sm font-extrabold text-slate-900">Eagle</div>
                  <button
                    type="button"
                    onClick={() =>
                      setPointsDraft((d) => ({ ...d, eagleEnabled: !d.eagleEnabled }))
                    }
                    className={[
                      "rounded-xl px-3 py-2 text-xs font-extrabold ring-1",
                      pointsDraft.eagleEnabled
                        ? "bg-emerald-600 text-white ring-emerald-600 hover:bg-emerald-500"
                        : "bg-slate-100 text-slate-900 ring-slate-200 hover:bg-slate-200",
                    ].join(" ")}
                  >
                    {pointsDraft.eagleEnabled ? "On" : "Off"}
                  </button>
                  <input
                    value={String(pointsDraft.eaglePoints)}
                    onChange={(e) =>
                      setPointsDraft((d) => ({ ...d, eaglePoints: e.target.value }))
                    }
                    inputMode="numeric"
                    disabled={!pointsDraft.eagleEnabled}
                    className={[
                      "w-full rounded-xl border px-3 py-2 text-sm font-extrabold outline-none ring-emerald-200 focus:ring-4",
                      pointsDraft.eagleEnabled
                        ? "border-slate-200 bg-white text-slate-900"
                        : "border-slate-200 bg-slate-50 text-slate-400",
                    ].join(" ")}
                  />
                </div>

                {/* HIO */}
                <div className="grid grid-cols-[1fr_70px_120px] items-center gap-2">
                  <div className="text-sm font-extrabold text-slate-900">Hole in one</div>
                  <button
                    type="button"
                    onClick={() =>
                      setPointsDraft((d) => ({ ...d, hioEnabled: !d.hioEnabled }))
                    }
                    className={[
                      "rounded-xl px-3 py-2 text-xs font-extrabold ring-1",
                      pointsDraft.hioEnabled
                        ? "bg-emerald-600 text-white ring-emerald-600 hover:bg-emerald-500"
                        : "bg-slate-100 text-slate-900 ring-slate-200 hover:bg-slate-200",
                    ].join(" ")}
                  >
                    {pointsDraft.hioEnabled ? "On" : "Off"}
                  </button>
                  <input
                    value={String(pointsDraft.hioPoints)}
                    onChange={(e) =>
                      setPointsDraft((d) => ({ ...d, hioPoints: e.target.value }))
                    }
                    inputMode="numeric"
                    disabled={!pointsDraft.hioEnabled}
                    className={[
                      "w-full rounded-xl border px-3 py-2 text-sm font-extrabold outline-none ring-emerald-200 focus:ring-4",
                      pointsDraft.hioEnabled
                        ? "border-slate-200 bg-white text-slate-900"
                        : "border-slate-200 bg-slate-50 text-slate-400",
                    ].join(" ")}
                  />
                </div>

                <div className="text-xs font-semibold text-slate-500">
                  (MVP) These are simple “did you get one?” toggles — no scorecard counting yet.
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={applyPointsSettings}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-extrabold text-white hover:bg-slate-800"
            >
              Save points
            </button>
            <button
              type="button"
              onClick={() => setShowPoints(false)}
              className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-extrabold text-slate-900 hover:bg-slate-200"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      {/* End season modal */}
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





