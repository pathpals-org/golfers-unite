// src/utils/storage.js
import { seedData } from "../data/seed";

export const KEYS = {
  users: "users",
  league: "league",
  rounds: "rounds",
  trophies: "trophies",
  badges: "badges",
  listings: "listings",
  listingMessages: "listingMessages",
  watchlist: "watchlist",
  playPosts: "playPosts",
  playRequests: "playRequests",
  seasonArchives: "seasonArchives",
  seededFlag: "__golfers_unite_seeded__",
};

const STORAGE_KEYS = [
  KEYS.users,
  KEYS.league,
  KEYS.rounds,
  KEYS.trophies,
  KEYS.badges,
  KEYS.listings,
  KEYS.listingMessages,
  KEYS.watchlist,
  KEYS.playPosts,
  KEYS.playRequests,
  KEYS.seasonArchives,
];

export function get(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function set(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

/**
 * Seed the app once (front-end only).
 */
export function seedIfNeeded() {
  const hasSeed = localStorage.getItem(KEYS.seededFlag);
  if (hasSeed) return;

  const data = seedData();
  STORAGE_KEYS.forEach((key) => {
    if (data[key] !== undefined) {
      set(key, data[key]);
    }
  });

  localStorage.setItem(KEYS.seededFlag, "true");
}

/* ---------------------------------------------
   App-specific helpers (so pages stay consistent)
---------------------------------------------- */

function ensureObj(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

function ensureArr(v) {
  return Array.isArray(v) ? v : [];
}

function isNum(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function toInt(n, fallback = 0) {
  const x = typeof n === "string" ? Number(n) : n;
  return Number.isFinite(x) ? Math.trunc(x) : fallback;
}

/**
 * USERS / PLAYERS
 * We treat "users" as your league players list.
 */
export function getUsers(fallback = []) {
  return get(KEYS.users, fallback) || fallback;
}

export function setUsers(users) {
  set(KEYS.users, ensureArr(users));
}

/**
 * LEAGUE
 * This typically holds season info + config.
 */
export function getLeague(fallback = {}) {
  return get(KEYS.league, fallback) || fallback;
}

export function setLeague(leagueObj) {
  set(KEYS.league, leagueObj || {});
}

/* ---------------------------------------------
   POINTS SYSTEM (broad, MVP-clean)
   Stored at: league.pointsSystem
---------------------------------------------- */

/**
 * Default "broad" points system:
 * - Mode = "medal" (lowest score wins)
 * - Placement points table (customisable)
 * - Optional extras (all off by default)
 */
export const DEFAULT_POINTS_SYSTEM = {
  mode: "medal", // "medal" | "stableford" | "handicap"
  placementPoints: { 1: 3, 2: 2, 3: 0 }, // MVP default (you can change to 1st=3, 2nd=1, 3rd=0 per league)
  participation: { enabled: false, points: 1 },

  bonuses: {
    enabled: false,
    birdie: { enabled: false, points: 1 },
    eagle: { enabled: false, points: 2 },
    hio: { enabled: false, points: 5 },
  },

  // Reserved for future society extras (CTP, Longest Drive, etc.)
  extras: { enabled: false },
};

function normalizePlacementPoints(v) {
  const raw = ensureObj(v);
  const next = {};
  Object.keys(raw).forEach((k) => {
    const place = toInt(k, NaN);
    const pts = toInt(raw[k], 0);
    if (Number.isFinite(place) && place > 0) next[place] = pts;
  });

  // If empty or invalid, fall back to default
  const keys = Object.keys(next);
  if (!keys.length) return { ...DEFAULT_POINTS_SYSTEM.placementPoints };

  // Ensure stable numeric keys (as numbers) in logic later
  // (JS object keys become strings, but that's fine — we access via String(place))
  return next;
}

function normalizePointsSystem(ps) {
  const raw = ensureObj(ps);

  const mode =
    raw.mode === "stableford" || raw.mode === "handicap" || raw.mode === "medal"
      ? raw.mode
      : DEFAULT_POINTS_SYSTEM.mode;

  const placementPoints = normalizePlacementPoints(
    raw.placementPoints ?? raw.placement ?? raw.pointsTable
  );

  const participationRaw = ensureObj(raw.participation);
  const participation = {
    enabled: Boolean(participationRaw.enabled ?? DEFAULT_POINTS_SYSTEM.participation.enabled),
    points: toInt(
      participationRaw.points ?? DEFAULT_POINTS_SYSTEM.participation.points,
      DEFAULT_POINTS_SYSTEM.participation.points
    ),
  };

  const bonusesRaw = ensureObj(raw.bonuses);
  const birdieRaw = ensureObj(bonusesRaw.birdie);
  const eagleRaw = ensureObj(bonusesRaw.eagle);
  const hioRaw = ensureObj(bonusesRaw.hio);

  const bonuses = {
    enabled: Boolean(bonusesRaw.enabled ?? DEFAULT_POINTS_SYSTEM.bonuses.enabled),
    birdie: {
      enabled: Boolean(birdieRaw.enabled ?? DEFAULT_POINTS_SYSTEM.bonuses.birdie.enabled),
      points: toInt(
        birdieRaw.points ?? DEFAULT_POINTS_SYSTEM.bonuses.birdie.points,
        DEFAULT_POINTS_SYSTEM.bonuses.birdie.points
      ),
    },
    eagle: {
      enabled: Boolean(eagleRaw.enabled ?? DEFAULT_POINTS_SYSTEM.bonuses.eagle.enabled),
      points: toInt(
        eagleRaw.points ?? DEFAULT_POINTS_SYSTEM.bonuses.eagle.points,
        DEFAULT_POINTS_SYSTEM.bonuses.eagle.points
      ),
    },
    hio: {
      enabled: Boolean(hioRaw.enabled ?? DEFAULT_POINTS_SYSTEM.bonuses.hio.enabled),
      points: toInt(
        hioRaw.points ?? DEFAULT_POINTS_SYSTEM.bonuses.hio.points,
        DEFAULT_POINTS_SYSTEM.bonuses.hio.points
      ),
    },
  };

  const extrasRaw = ensureObj(raw.extras);

  return {
    ...DEFAULT_POINTS_SYSTEM,
    ...raw,
    mode,
    placementPoints,
    participation,
    bonuses,
    extras: {
      enabled: Boolean(extrasRaw.enabled ?? DEFAULT_POINTS_SYSTEM.extras.enabled),
      ...extrasRaw,
    },
  };
}

/**
 * Single source of truth: league.pointsSystem
 * Always returns a normalised object (never null), so UI doesn’t crash.
 */
export function getPointsSystem(fallback = null) {
  const league = getLeague({});
  const stored = league?.pointsSystem;

  if (!stored && fallback) return normalizePointsSystem(fallback);
  if (!stored) return normalizePointsSystem(DEFAULT_POINTS_SYSTEM);

  return normalizePointsSystem(stored);
}

/**
 * Writes the points system back into league safely.
 * Accepts partial updates (we merge + normalise).
 */
export function setPointsSystem(pointsSystem) {
  const league = getLeague({});
  const current = getPointsSystem(DEFAULT_POINTS_SYSTEM);
  const merged = normalizePointsSystem({ ...current, ...ensureObj(pointsSystem) });
  setLeague({ ...league, pointsSystem: merged });
  return merged;
}

/**
 * Helper: update just placement points quickly.
 * Example: setPlacementPoints({ 1: 3, 2: 1, 3: 0 })
 */
export function setPlacementPoints(placementPoints) {
  return setPointsSystem({ placementPoints });
}

/**
 * Core helper for awarding points.
 *
 * Inputs:
 * - place: 1,2,3... (optional)
 * - bonusFlags: { birdie?: boolean, eagle?: boolean, hio?: boolean } (optional)
 * - played: boolean (optional) — if participation is enabled, this gives points
 *
 * Output:
 * { placementPoints, bonusPoints, participationPoints, totalPoints }
 */
export function calculateLeaguePoints({
  place = null,
  bonusFlags = {},
  played = true,
  pointsSystem = null,
} = {}) {
  const ps = normalizePointsSystem(pointsSystem || getPointsSystem(DEFAULT_POINTS_SYSTEM));

  // Placement
  const p = toInt(place, NaN);
  const placementPoints = Number.isFinite(p) && p > 0 ? toInt(ps.placementPoints[p], 0) : 0;

  // Participation
  const participationPoints =
    played && ps.participation?.enabled ? toInt(ps.participation.points, 0) : 0;

  // Bonuses (MVP = simple yes/no flags)
  let bonusPoints = 0;
  const flags = ensureObj(bonusFlags);

  if (ps.bonuses?.enabled) {
    if (ps.bonuses.birdie?.enabled && Boolean(flags.birdie)) {
      bonusPoints += toInt(ps.bonuses.birdie.points, 0);
    }
    if (ps.bonuses.eagle?.enabled && Boolean(flags.eagle)) {
      bonusPoints += toInt(ps.bonuses.eagle.points, 0);
    }
    if (ps.bonuses.hio?.enabled && Boolean(flags.hio)) {
      bonusPoints += toInt(ps.bonuses.hio.points, 0);
    }
  }

  const totalPoints = placementPoints + participationPoints + bonusPoints;

  return {
    placementPoints,
    participationPoints,
    bonusPoints,
    totalPoints,
  };
}

/**
 * Helper: sort rounds to determine placing for a given day/event.
 * You can pass in an array of rounds and the pointsSystem (or it will use league’s).
 *
 * Notes:
 * - medal: lower score wins
 * - stableford: higher stableford wins
 * - handicap: higher "vsHandicap" wins (positive = beat handicap)
 *
 * We return a NEW array sorted best-to-worst.
 * Ties are kept together by score; your UI can decide how to display ties.
 */
export function sortRoundsForRanking(rounds, pointsSystem = null) {
  const ps = normalizePointsSystem(pointsSystem || getPointsSystem(DEFAULT_POINTS_SYSTEM));
  const list = ensureArr(rounds).slice();

  if (ps.mode === "stableford") {
    // Expect round.stablefordPoints (number)
    return list.sort((a, b) => {
      const av = isNum(a?.stablefordPoints) ? a.stablefordPoints : -999999;
      const bv = isNum(b?.stablefordPoints) ? b.stablefordPoints : -999999;
      return bv - av;
    });
  }

  if (ps.mode === "handicap") {
    // Expect round.vsHandicap (number). Example: +2 means 2 shots better than handicap.
    return list.sort((a, b) => {
      const av = isNum(a?.vsHandicap) ? a.vsHandicap : -999999;
      const bv = isNum(b?.vsHandicap) ? b.vsHandicap : -999999;
      return bv - av;
    });
  }

  // Default: medal
  // Expect round.score (number) where lower is better
  return list.sort((a, b) => {
    const av = isNum(a?.score) ? a.score : 999999;
    const bv = isNum(b?.score) ? b.score : 999999;
    return av - bv;
  });
}

/* ---------------------------------------------
   ROUNDS
---------------------------------------------- */

export function getRounds(fallback = []) {
  return get(KEYS.rounds, fallback) || fallback;
}

export function setRounds(rounds) {
  set(KEYS.rounds, ensureArr(rounds));
}

/**
 * Adds a round to the top (newest-first).
 */
export function addRound(round) {
  const rounds = getRounds([]);
  const next = [round, ...rounds];
  setRounds(next);
  return round;
}

/**
 * Filter rounds by playerId
 */
export function getRoundsByPlayer(playerId) {
  const rounds = getRounds([]);
  return rounds.filter((r) => r?.playerId === playerId);
}

/* ---------------------------------------------
   BADGES
---------------------------------------------- */

/**
 * BADGES
 * Stored keyed by playerId:
 * badges: { [playerId]: Badge[] }
 */
export function getBadges(fallback = {}) {
  return ensureObj(get(KEYS.badges, fallback));
}

export function setBadges(map) {
  set(KEYS.badges, ensureObj(map));
}

/* ---------------------------------------------
   TROPHIES (compat safe)
---------------------------------------------- */

/**
 * TROPHIES
 * IMPORTANT COMPAT:
 * - Your League page end-season flow uses trophies as an ARRAY (historical trophies).
 * - SubmitRound awards use trophies as a MAP keyed by playerId.
 *
 * Solution: support BOTH without breaking anything:
 * - getTrophies() returns either array OR map (whatever is stored)
 * - setTrophies() accepts either array OR map
 * - getTrophiesMap() always returns a safe map view
 * - setTrophiesMap() writes map
 */
export function getTrophies(fallback = []) {
  const raw = get(KEYS.trophies, fallback);
  return raw ?? fallback;
}

export function setTrophies(value) {
  // Accept array OR object
  if (Array.isArray(value)) {
    set(KEYS.trophies, value);
    return;
  }
  set(KEYS.trophies, ensureObj(value));
}

export function getTrophiesMap() {
  const raw = get(KEYS.trophies, {});
  if (Array.isArray(raw)) {
    // Convert array trophies -> map by userId (lossless enough for UI)
    return raw.reduce((acc, t) => {
      const uid = t?.userId;
      if (!uid) return acc;
      if (!acc[uid]) acc[uid] = [];
      acc[uid].push(t);
      return acc;
    }, {});
  }
  return ensureObj(raw);
}

export function setTrophiesMap(map) {
  set(KEYS.trophies, ensureObj(map));
}

/**
 * Award helpers (de-duped by key)
 */
export function awardBadge(playerId, badge) {
  const all = getBadges({});
  const existing = ensureArr(all[playerId]);
  const already = existing.some((b) => b?.key === badge?.key);
  if (already) return false;

  const nextBadge = {
    ...badge,
    earnedAt: badge?.earnedAt || new Date().toISOString(),
  };

  setBadges({ ...all, [playerId]: [nextBadge, ...existing] });
  return true;
}

export function awardTrophy(playerId, trophy) {
  const all = getTrophiesMap();
  const existing = ensureArr(all[playerId]);
  const already = existing.some((t) => t?.key === trophy?.key);
  if (already) return false;

  const nextTrophy = {
    ...trophy,
    earnedAt: trophy?.earnedAt || new Date().toISOString(),
  };

  setTrophiesMap({ ...all, [playerId]: [nextTrophy, ...existing] });
  return true;
}

/* ---------------------------------------------
   SEASON ARCHIVES
---------------------------------------------- */

export function getSeasonArchives(fallback = []) {
  return get(KEYS.seasonArchives, fallback) || fallback;
}

export function addSeasonArchive(archiveItem) {
  const archives = getSeasonArchives([]);
  const next = [archiveItem, ...archives];
  set(KEYS.seasonArchives, next);
  return archiveItem;
}



