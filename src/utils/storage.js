// src/utils/storage.js
import { seedData } from "../data/seed";
import { supabase } from "../lib/supabaseClient";

/**
 * ✅ IMPORTANT MIGRATION NOTE
 * Supabase is the source of truth.
 * localStorage is ONLY a demo/offline cache layer while you migrate.
 * This file keeps the cache safe + scoped per signed-in user to prevent cross-account bleed.
 */

/* ---------------------------------------------
   KEYS (base keys before scoping)
---------------------------------------------- */

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

  // active league selection (support multiple leagues later)
  activeLeagueId: "__golfers_unite_active_league_id__",
};

// identifies which signed-in user the offline/local cache belongs to
export const STORAGE_USER_KEY = "__golfers_unite_storage_user_id__";

export function getStorageUserId() {
  try {
    return localStorage.getItem(STORAGE_USER_KEY) || null;
  } catch {
    return null;
  }
}

/**
 * ✅ Call this from Auth on login/logout to scope local cache.
 * - When user logs in: setStorageUserId(user.id)
 * - When user logs out: setStorageUserId(null)
 */
export function setStorageUserId(userId) {
  try {
    if (!userId) localStorage.removeItem(STORAGE_USER_KEY);
    else localStorage.setItem(STORAGE_USER_KEY, String(userId));
  } catch {
    // ignore
  }
}

/* ---------------------------------------------
   KEY SCOPING (prevents cross-account bleed)
---------------------------------------------- */

function scopedKey(baseKey) {
  // Keep Supabase auth tokens untouched (sb-...-auth-token)
  // Only scope OUR app keys.
  const uid = getStorageUserId();
  if (!uid) return baseKey;
  return `${uid}::${baseKey}`;
}

/* ---------------------------------------------
   Generic localStorage helpers (scoped)
---------------------------------------------- */

export function get(key, fallback = null) {
  try {
    const raw = localStorage.getItem(scopedKey(key));
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function set(key, value) {
  localStorage.setItem(scopedKey(key), JSON.stringify(value));
}

export function remove(key) {
  try {
    localStorage.removeItem(scopedKey(key));
  } catch {
    // ignore
  }
}

/* ---------------------------------------------
   Seed (scoped demo/offline cache)
---------------------------------------------- */

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

export function seedIfNeeded() {
  // Seed is per-user (scoped). If no user id is set, it seeds the unscoped demo cache.
  const hasSeed = localStorage.getItem(scopedKey(KEYS.seededFlag));
  if (hasSeed) return;

  const data = seedData();

  STORAGE_KEYS.forEach((k) => {
    if (data[k] !== undefined) set(k, data[k]);
  });

  localStorage.setItem(scopedKey(KEYS.seededFlag), "true");
}

/* ---------------------------------------------
   App-specific helpers (safe normalizers)
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

function isISODateString(v) {
  return typeof v === "string" && v.length >= 10;
}

function toISODateOrNull(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return v;
  return null;
}

/* ---------------------------------------------
   ACTIVE LEAGUE (cache helper)
---------------------------------------------- */

export function getActiveLeagueId() {
  try {
    // Active league is also scoped (per user)
    return localStorage.getItem(scopedKey(KEYS.activeLeagueId)) || null;
  } catch {
    return null;
  }
}

export function setActiveLeagueId(leagueId) {
  try {
    if (!leagueId) localStorage.removeItem(scopedKey(KEYS.activeLeagueId));
    else localStorage.setItem(scopedKey(KEYS.activeLeagueId), String(leagueId));
  } catch {
    // ignore
  }
}

/* ---------------------------------------------
   Supabase helpers (source of truth reads)
---------------------------------------------- */

async function fetchMyLeagueIds() {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return [];

  const { data, error } = await supabase
    .from("league_members")
    .select("league_id")
    .eq("user_id", uid);

  if (error) throw error;
  return ensureArr(data).map((r) => r.league_id).filter(Boolean);
}

/**
 * IMPORTANT:
 * Your DB does NOT have leagues.season_start (you saw that error).
 * So we only select columns we know exist.
 */
async function fetchLeagueById(leagueId) {
  const { data, error } = await supabase
    .from("leagues")
    .select("id,name,host_user_id,points_system,created_at")
    .eq("id", leagueId)
    .single();

  if (error) throw error;
  return data || null;
}

async function fetchLeagueMembers(leagueId) {
  const { data, error } = await supabase
    .from("league_members")
    .select("user_id,role")
    .eq("league_id", leagueId);

  if (error) throw error;
  return ensureArr(data);
}

async function fetchProfilesByIds(userIds) {
  const ids = ensureArr(userIds).filter(Boolean);
  if (!ids.length) return [];

  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,display_name,created_at")
    .in("id", ids);

  if (error) throw error;
  return ensureArr(data);
}

/**
 * ✅ Main sync (Supabase -> cache):
 * - Supabase is truth
 * - localStorage is just a cache (scoped)
 *
 * FAIL-SOFT:
 * - If Supabase fails (offline/RLS/transient), DO NOT wipe cache.
 * - Return cached values so app stays usable.
 */
export async function syncActiveLeagueFromSupabase({ leagueId = null } = {}) {
  const cachedLeague = getLeagueSafe({});
  const cachedUsers = ensureArr(getUsers([]));

  try {
    // 1) Resolve active league id
    let activeId = leagueId || getActiveLeagueId();

    if (!activeId) {
      const myLeagueIds = await fetchMyLeagueIds();
      activeId = myLeagueIds[0] || null;
      if (activeId) setActiveLeagueId(activeId);
    }

    // No memberships: return cache (demo/offline)
    if (!activeId) {
      return { league: cachedLeague?.id ? cachedLeague : null, users: cachedUsers };
    }

    // 2) Fetch league + members + profiles
    const leagueRow = await fetchLeagueById(activeId);
    const members = await fetchLeagueMembers(activeId);

    const memberIds = members.map((m) => m.user_id).filter(Boolean);
    const profiles = await fetchProfilesByIds(memberIds);

    // 3) Build users list for UI
    const users = profiles.map((p) => ({
      id: p.id,
      name: p.display_name || (p.email ? p.email.split("@")[0] : "Golfer"),
      email: p.email || null,
    }));

    // 4) Build league object in normalized format
    const memberRoles = {};
    members.forEach((m) => {
      if (!m?.user_id) return;
      memberRoles[m.user_id] = normalizeRole(m.role);
    });

    const nextLeague = normalizeLeague({
      id: leagueRow?.id,
      name: leagueRow?.name || "League",
      members: memberIds,
      memberRoles,
      pointsSystem: leagueRow?.points_system || null,

      // Season fields are local-only unless you add DB columns later.
      // Keep stable for UI.
      seasonStartISO: cachedLeague?.seasonStartISO || new Date().toISOString(),
      seasonEndISO: cachedLeague?.seasonEndISO || null,
    });

    // 5) Cache (scoped)
    setLeagueSafe(nextLeague);
    setUsers(users);

    return { league: nextLeague, users };
  } catch {
    // FAIL-SOFT: keep cached fallback
    return { league: cachedLeague?.id ? cachedLeague : null, users: cachedUsers };
  }
}

/* ---------------------------------------------
   USERS / PLAYERS (cached local)
---------------------------------------------- */

export function getUsers(fallback = []) {
  return get(KEYS.users, fallback) || fallback;
}

export function setUsers(users) {
  set(KEYS.users, ensureArr(users));
}

/* ---------------------------------------------
   LEAGUE (cached local)
---------------------------------------------- */

export function getLeague(fallback = {}) {
  return get(KEYS.league, fallback) || fallback;
}

export function setLeague(leagueObj) {
  set(KEYS.league, leagueObj || {});
}

/* ---------------------------------------------
   LEAGUE ROLES + SEASON HELPERS (cache only)
---------------------------------------------- */

export const LEAGUE_ROLES = {
  host: "host",
  co_host: "co_host",
  member: "member",
};

function normalizeRole(role) {
  return role === LEAGUE_ROLES.host ||
    role === LEAGUE_ROLES.co_host ||
    role === LEAGUE_ROLES.member
    ? role
    : LEAGUE_ROLES.member;
}

function normalizeMemberRoles(league) {
  const l = ensureObj(league);
  const members = ensureArr(l.members);

  const existing = ensureObj(l.memberRoles);
  const next = {};

  members.forEach((id) => {
    if (!id) return;
    next[id] = normalizeRole(existing[id] || LEAGUE_ROLES.member);
  });

  // cache-safety: ensure a host exists
  const hasHost = Object.values(next).some((r) => r === LEAGUE_ROLES.host);
  if (!hasHost && members.length) {
    next[members[0]] = LEAGUE_ROLES.host;
  }

  return next;
}

function normalizeLeague(league) {
  const l = ensureObj(league);

  const members = ensureArr(l.members);
  const memberRoles = normalizeMemberRoles({ ...l, members });

  const seasonStartISO = isISODateString(l.seasonStartISO)
    ? l.seasonStartISO
    : new Date().toISOString();

  const seasonEndISO = isISODateString(l.seasonEndISO) ? l.seasonEndISO : null;

  return {
    ...l,
    members,
    memberRoles,
    seasonStartISO,
    seasonEndISO,
  };
}

export function getLeagueSafe(fallback = {}) {
  const raw = getLeague(fallback);
  if (!raw || typeof raw !== "object") return ensureObj(fallback);
  return normalizeLeague(raw);
}

export function setLeagueSafe(leagueObj) {
  const next = normalizeLeague(leagueObj || {});
  setLeague(next);
  return next;
}

export function getLeagueRole(userId) {
  const league = getLeagueSafe({});
  const roles = ensureObj(league.memberRoles);
  if (!userId) return LEAGUE_ROLES.member;
  return normalizeRole(roles[userId] || LEAGUE_ROLES.member);
}

export function isLeagueAdmin(userId) {
  const role = getLeagueRole(userId);
  return role === LEAGUE_ROLES.host || role === LEAGUE_ROLES.co_host;
}

export function setLeagueRole(userId, role) {
  if (!userId) return null;

  const league = getLeagueSafe({});
  const roles = ensureObj(league.memberRoles);

  const nextRoles = {
    ...roles,
    [userId]: normalizeRole(role),
  };

  const nextLeague = {
    ...league,
    memberRoles: nextRoles,
  };

  setLeagueSafe(nextLeague);
  return nextLeague;
}

export function setLeagueSeasonDates({ startISO, endISO = null } = {}) {
  const league = getLeagueSafe({});
  const next = {
    ...league,
    seasonStartISO: toISODateOrNull(startISO) || league.seasonStartISO,
    seasonEndISO: toISODateOrNull(endISO),
  };
  setLeagueSafe(next);
  return next;
}

/* ---------------------------------------------
   POINTS SYSTEM (cached local)
---------------------------------------------- */

export const DEFAULT_POINTS_SYSTEM = {
  mode: "medal",
  placementPoints: { 1: 3, 2: 2, 3: 0 },
  participation: { enabled: false, points: 1 },
  bonuses: {
    enabled: false,
    birdie: { enabled: false, points: 1 },
    eagle: { enabled: false, points: 2 },
    hio: { enabled: false, points: 5 },
  },
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

  const keys = Object.keys(next);
  if (!keys.length) return { ...DEFAULT_POINTS_SYSTEM.placementPoints };
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
    enabled: Boolean(
      participationRaw.enabled ?? DEFAULT_POINTS_SYSTEM.participation.enabled
    ),
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

export function getPointsSystem(fallback = null) {
  const league = getLeagueSafe({});
  const stored = league?.pointsSystem;

  if (!stored && fallback) return normalizePointsSystem(fallback);
  if (!stored) return normalizePointsSystem(DEFAULT_POINTS_SYSTEM);
  return normalizePointsSystem(stored);
}

export function setPointsSystem(pointsSystem) {
  const league = getLeagueSafe({});
  const current = getPointsSystem(DEFAULT_POINTS_SYSTEM);
  const merged = normalizePointsSystem({ ...current, ...ensureObj(pointsSystem) });
  setLeagueSafe({ ...league, pointsSystem: merged });
  return merged;
}

export function setPlacementPoints(placementPoints) {
  return setPointsSystem({ placementPoints });
}

export function calculateLeaguePoints({
  place = null,
  bonusFlags = {},
  played = true,
  pointsSystem = null,
} = {}) {
  const ps = normalizePointsSystem(pointsSystem || getPointsSystem(DEFAULT_POINTS_SYSTEM));

  const p = toInt(place, NaN);
  const placementPoints = Number.isFinite(p) && p > 0 ? toInt(ps.placementPoints[p], 0) : 0;

  const participationPoints =
    played && ps.participation?.enabled ? toInt(ps.participation.points, 0) : 0;

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

  return { placementPoints, participationPoints, bonusPoints, totalPoints };
}

export function sortRoundsForRanking(rounds, pointsSystem = null) {
  const ps = normalizePointsSystem(pointsSystem || getPointsSystem(DEFAULT_POINTS_SYSTEM));
  const list = ensureArr(rounds).slice();

  if (ps.mode === "stableford") {
    return list.sort((a, b) => {
      const av = isNum(a?.stablefordPoints) ? a.stablefordPoints : -999999;
      const bv = isNum(b?.stablefordPoints) ? b.stablefordPoints : -999999;
      return bv - av;
    });
  }

  if (ps.mode === "handicap") {
    return list.sort((a, b) => {
      const av = isNum(a?.vsHandicap) ? a.vsHandicap : -999999;
      const bv = isNum(b?.vsHandicap) ? b.vsHandicap : -999999;
      return bv - av;
    });
  }

  return list.sort((a, b) => {
    const av = isNum(a?.score) ? a.score : 999999;
    const bv = isNum(b?.score) ? b.score : 999999;
    return av - bv;
  });
}

/* ---------------------------------------------
   ROUNDS (still local for now)
---------------------------------------------- */

export function getRounds(fallback = []) {
  return get(KEYS.rounds, fallback) || fallback;
}

export function setRounds(rounds) {
  set(KEYS.rounds, ensureArr(rounds));
}

export function addRound(round) {
  const rounds = getRounds([]);
  const next = [round, ...rounds];
  setRounds(next);
  return round;
}

export function getRoundsByPlayer(playerId) {
  const rounds = getRounds([]);
  return rounds.filter((r) => r?.playerId === playerId);
}

/* ---------------------------------------------
   BADGES
---------------------------------------------- */

export function getBadges(fallback = {}) {
  return ensureObj(get(KEYS.badges, fallback));
}

export function setBadges(map) {
  set(KEYS.badges, ensureObj(map));
}

/* ---------------------------------------------
   TROPHIES (compat safe)
---------------------------------------------- */

export function getTrophies(fallback = []) {
  const raw = get(KEYS.trophies, fallback);
  return raw ?? fallback;
}

export function setTrophies(value) {
  if (Array.isArray(value)) {
    set(KEYS.trophies, value);
    return;
  }
  set(KEYS.trophies, ensureObj(value));
}

export function getTrophiesMap() {
  const raw = get(KEYS.trophies, {});
  if (Array.isArray(raw)) {
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





