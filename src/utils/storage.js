// src/utils/storage.js

import { seedData } from "../data/seed";
import { supabase } from "../lib/supabaseClient";

/**
 * ✅ MIGRATION NOTE (Golfers Unite)
 * Supabase is the SOURCE OF TRUTH going forward.
 * localStorage is ONLY a safe UI cache / offline demo fallback during migration.
 *
 * Critical rules:
 * - Permissions must be based ONLY on Supabase league_members.role (never cached roles).
 * - League settings must be able to resolve a leagueId even if router state is missing.
 * - Fail-soft: if Supabase is unavailable, do NOT wipe caches.
 */

/* ---------------------------------------------
   KEYS (base keys before scoping)
---------------------------------------------- */
export const KEYS = {
  users: "users", // UI cache
  league: "league", // UI cache (active league summary)
  rounds: "rounds", // UI cache (active league rounds)
  trophies: "trophies",
  badges: "badges",
  listings: "listings",
  listingMessages: "listingMessages",
  watchlist: "watchlist",
  playPosts: "playPosts",
  playRequests: "playRequests",
  seasonArchives: "seasonArchives",
  seededFlag: "__golfers_unite_seeded__",

  // Active league selection (stored in Supabase if possible, local fallback)
  activeLeagueId: "__golfers_unite_active_league_id__",
};

// identifies which signed-in user the offline/local cache belongs to
export const STORAGE_USER_KEY = "__golfers_unite_storage_user_id__";

export function getStorageUserId() {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(STORAGE_USER_KEY) || null;
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
    if (typeof window === "undefined") return;
    if (!userId) window.localStorage.removeItem(STORAGE_USER_KEY);
    else window.localStorage.setItem(STORAGE_USER_KEY, String(userId));
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
    if (typeof window === "undefined") return fallback;
    const raw = window.localStorage.getItem(scopedKey(key));
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function set(key, value) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(scopedKey(key), JSON.stringify(value));
  } catch {
    // ignore
  }
}

export function remove(key) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(scopedKey(key));
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
  try {
    if (typeof window === "undefined") return;
    const hasSeed = window.localStorage.getItem(scopedKey(KEYS.seededFlag));
    if (hasSeed) return;

    const data = seedData();
    STORAGE_KEYS.forEach((k) => {
      if (data[k] !== undefined) set(k, data[k]);
    });

    window.localStorage.setItem(scopedKey(KEYS.seededFlag), "true");
  } catch {
    // ignore
  }
}

/* ---------------------------------------------
   Safe normalizers
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
   Supabase auth helper
---------------------------------------------- */
async function getAuthedUserId() {
  const { data: auth } = await supabase.auth.getUser();
  return auth?.user?.id || null;
}

/* ---------------------------------------------
   ACTIVE LEAGUE (Supabase source of truth + local fallback)
   We TRY to store activeLeagueId in profiles.active_league_id (if that column exists).
   If the column doesn't exist yet, this will fail-soft and use localStorage only.
---------------------------------------------- */
export function getActiveLeagueId() {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(scopedKey(KEYS.activeLeagueId)) || null;
  } catch {
    return null;
  }
}

function setActiveLeagueIdLocal(leagueId) {
  try {
    if (typeof window === "undefined") return;
    if (!leagueId) window.localStorage.removeItem(scopedKey(KEYS.activeLeagueId));
    else window.localStorage.setItem(scopedKey(KEYS.activeLeagueId), String(leagueId));
  } catch {
    // ignore
  }
}

/**
 * Writes active league preference to Supabase (profiles.active_league_id) if available,
 * and ALWAYS updates local fallback cache.
 */
export async function setActiveLeagueId(leagueId) {
  setActiveLeagueIdLocal(leagueId);
  try {
    const uid = await getAuthedUserId();
    if (!uid) return leagueId || null;

    // Fail-soft if column doesn't exist or RLS blocks it.
    await supabase.from("profiles").update({ active_league_id: leagueId || null }).eq("id", uid);
    return leagueId || null;
  } catch {
    return leagueId || null;
  }
}

/**
 * Reads active league preference from Supabase first (profiles.active_league_id),
 * falling back to local.
 *
 * ✅ CHANGE: use maybeSingle() so “no row” doesn’t hard-error and force view-only weirdness.
 */
export async function getActiveLeagueIdSupabaseFirst() {
  const local = getActiveLeagueId();
  try {
    const uid = await getAuthedUserId();
    if (!uid) return local;

    const { data, error } = await supabase
      .from("profiles")
      .select("active_league_id")
      .eq("id", uid)
      .maybeSingle();

    if (error) return local;

    const fromDb = data?.active_league_id || null;
    if (fromDb && fromDb !== local) setActiveLeagueIdLocal(fromDb);
    return fromDb || local;
  } catch {
    return local;
  }
}

/* ---------------------------------------------
   Supabase helpers (source of truth reads)
---------------------------------------------- */
async function fetchMyLeagueMemberships() {
  const uid = await getAuthedUserId();
  if (!uid) return [];

  // ✅ CHANGE: order newest-first so fallback pick is stable
  const { data, error } = await supabase
    .from("league_members")
    .select("league_id,role,created_at")
    .eq("user_id", uid)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return ensureArr(data).filter((r) => r?.league_id);
}

/**
 * IMPORTANT:
 * Only select columns we know exist.
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
 * ROUNDS (Supabase) — minimal assumptions:
 * - table: rounds
 * - has: id, league_id, user_id, created_at
 * - and other fields your app uses (score, playerId, etc.)
 *
 * We select * to avoid breaking if you store extra fields.
 */
async function fetchRoundsByLeagueId(leagueId) {
  const { data, error } = await supabase
    .from("rounds")
    .select("*")
    .eq("league_id", leagueId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return ensureArr(data);
}

/* ---------------------------------------------
   LEAGUE ROLES (Supabase truth)
---------------------------------------------- */
export const LEAGUE_ROLES = {
  host: "host",
  co_host: "co_host",
  member: "member",
};

/**
 * ✅ CHANGE (fixes “still view only” when DB uses a slightly different role string):
 * Accept common variants like:
 * - "cohost", "co-host", "co host", "co_host"
 * - "HOST", "Host"
 */
function normalizeRole(role) {
  const raw = String(role || "").trim().toLowerCase();
  if (!raw) return LEAGUE_ROLES.member;

  if (raw === "host") return LEAGUE_ROLES.host;

  // co-host variants
  if (raw === "co_host" || raw === "cohost" || raw === "co-host" || raw === "co host") {
    return LEAGUE_ROLES.co_host;
  }

  if (raw === "member") return LEAGUE_ROLES.member;

  // default fail-soft
  return LEAGUE_ROLES.member;
}

/**
 * ✅ Source-of-truth permission check.
 * NEVER use cached roles for permissions.
 *
 * ✅ CHANGE: maybeSingle() so “no row” doesn’t throw; we default to member.
 */
export async function getMyLeagueRoleSupabase(leagueId) {
  if (!leagueId) return LEAGUE_ROLES.member;
  const uid = await getAuthedUserId();
  if (!uid) return LEAGUE_ROLES.member;

  const { data, error } = await supabase
    .from("league_members")
    .select("role")
    .eq("league_id", leagueId)
    .eq("user_id", uid)
    .maybeSingle();

  if (error) return LEAGUE_ROLES.member; // fail-soft: view-only
  return normalizeRole(data?.role);
}

export async function isMyLeagueAdminSupabase(leagueId) {
  const role = await getMyLeagueRoleSupabase(leagueId);
  return role === LEAGUE_ROLES.host || role === LEAGUE_ROLES.co_host;
}

/**
 * Toggle co-host in Supabase. Only a host/co_host should be allowed by RLS.
 * After calling this, the UI should call syncActiveLeagueFromSupabase({ leagueId }).
 */
export async function setMemberRoleSupabase({ leagueId, userId, role }) {
  if (!leagueId || !userId) throw new Error("Missing leagueId/userId");
  const nextRole = normalizeRole(role);

  const { error } = await supabase
    .from("league_members")
    .update({ role: nextRole })
    .eq("league_id", leagueId)
    .eq("user_id", userId);

  if (error) throw error;
  return { leagueId, userId, role: nextRole };
}

/* ---------------------------------------------
   LEAGUE + USERS (UI caches)
---------------------------------------------- */
export function getUsers(fallback = []) {
  return get(KEYS.users, fallback) || fallback;
}
export function setUsers(users) {
  set(KEYS.users, ensureArr(users));
}
export function getLeague(fallback = {}) {
  return get(KEYS.league, fallback) || fallback;
}
export function setLeague(leagueObj) {
  set(KEYS.league, leagueObj || {});
}

/* ---------------------------------------------
   League cache normalizers (UI-only)
---------------------------------------------- */
function normalizeMemberRoles(league) {
  const l = ensureObj(league);
  const members = ensureArr(l.members);
  const existing = ensureObj(l.memberRoles);
  const next = {};
  members.forEach((id) => {
    if (!id) return;
    next[id] = normalizeRole(existing[id] || LEAGUE_ROLES.member);
  });
  return next;
}

function normalizeLeague(league) {
  const l = ensureObj(league);
  const members = ensureArr(l.members);
  const memberRoles = normalizeMemberRoles({ ...l, members });

  const seasonStartISO = isISODateString(l.seasonStartISO) ? l.seasonStartISO : new Date().toISOString();
  const seasonEndISO = isISODateString(l.seasonEndISO) ? l.seasonEndISO : null;

  return { ...l, members, memberRoles, seasonStartISO, seasonEndISO };
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

/* ---------------------------------------------
   POINTS SYSTEM (Supabase truth via leagues.points_system)
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

  const placementPoints = normalizePlacementPoints(raw.placementPoints ?? raw.placement ?? raw.pointsTable);

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
    extras: { enabled: Boolean(extrasRaw.enabled ?? DEFAULT_POINTS_SYSTEM.extras.enabled), ...extrasRaw },
  };
}

/**
 * Returns points system from cached league object (UI cache),
 * but the SOURCE OF TRUTH update happens via setPointsSystemSupabase.
 */
export function getPointsSystem(fallback = null) {
  const league = getLeagueSafe({});
  const stored = league?.pointsSystem;

  if (!stored && fallback) return normalizePointsSystem(fallback);
  if (!stored) return normalizePointsSystem(DEFAULT_POINTS_SYSTEM);
  return normalizePointsSystem(stored);
}

/**
 * ✅ Back-compat: old callers expect a sync function named setPointsSystem().
 * During migration we keep this, but it only updates the UI cache.
 * Supabase truth update must be done with setPointsSystemSupabase().
 */
export function setPointsSystem(pointsSystem) {
  const league = getLeagueSafe({});
  const current = getPointsSystem(DEFAULT_POINTS_SYSTEM);
  const merged = normalizePointsSystem({ ...current, ...ensureObj(pointsSystem) });
  setLeagueSafe({ ...league, pointsSystem: merged });
  return merged;
}

/**
 * ✅ Supabase truth update for leagues.points_system.
 * Also updates local UI cache.
 */
export async function setPointsSystemSupabase({ leagueId, pointsSystem }) {
  if (!leagueId) throw new Error("Missing leagueId");
  const merged = normalizePointsSystem(pointsSystem || DEFAULT_POINTS_SYSTEM);

  const { error } = await supabase.from("leagues").update({ points_system: merged }).eq("id", leagueId);
  if (error) throw error;

  // Update UI cache
  const league = getLeagueSafe({});
  if (league?.id && String(league.id) === String(leagueId)) {
    setLeagueSafe({ ...league, pointsSystem: merged });
  }

  return merged;
}

/* ---------------------------------------------
   ROUNDS (Supabase truth + UI cache)
---------------------------------------------- */
export function getRounds(fallback = []) {
  return get(KEYS.rounds, fallback) || fallback;
}
export function setRounds(rounds) {
  set(KEYS.rounds, ensureArr(rounds));
}

export async function syncRoundsFromSupabase({ leagueId }) {
  const cached = getRounds([]);
  try {
    if (!leagueId) return cached;
    const rows = await fetchRoundsByLeagueId(leagueId);
    setRounds(rows);
    return rows;
  } catch {
    return cached;
  }
}

export async function addRoundSupabase({ leagueId, round }) {
  if (!leagueId) throw new Error("Missing leagueId");
  const uid = await getAuthedUserId();

  const payload = {
    ...ensureObj(round),
    league_id: leagueId,
    user_id: uid || ensureObj(round)?.user_id || null,
  };

  const { data, error } = await supabase.from("rounds").insert(payload).select("*").single();
  if (error) throw error;

  const current = getRounds([]);
  setRounds([data, ...current]);
  return data;
}

export async function updateRoundSupabase({ roundId, patch }) {
  if (!roundId) throw new Error("Missing roundId");

  const { data, error } = await supabase.from("rounds").update(ensureObj(patch)).eq("id", roundId).select("*").single();
  if (error) throw error;

  const current = getRounds([]);
  const next = current.map((r) => (r?.id === roundId ? data : r));
  setRounds(next);
  return data;
}

export async function deleteRoundSupabase({ roundId }) {
  if (!roundId) throw new Error("Missing roundId");

  const { error } = await supabase.from("rounds").delete().eq("id", roundId);
  if (error) throw error;

  const current = getRounds([]);
  setRounds(current.filter((r) => r?.id !== roundId));
  return true;
}

/**
 * Backwards compat helpers (LOCAL ONLY) — keep during migration,
 * but your League pages should use the Supabase async versions.
 */
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
   ✅ MAIN SYNC: Supabase -> UI cache hydration
---------------------------------------------- */
export async function resolveLeagueIdSupabaseFirst({ preferredLeagueId = null } = {}) {
  // 1) preferred input
  if (preferredLeagueId) return String(preferredLeagueId);

  // 2) supabase profile active_league_id (if exists) else local
  const fromPref = await getActiveLeagueIdSupabaseFirst();
  if (fromPref) return String(fromPref);

  // 3) membership fallback (most recent membership)
  try {
    const memberships = await fetchMyLeagueMemberships();
    if (memberships.length) {
      const pick = memberships[0]?.league_id || null;
      if (pick) {
        await setActiveLeagueId(pick);
        return String(pick);
      }
    }
  } catch {
    // ignore
  }

  return null;
}

export async function syncActiveLeagueFromSupabase({ leagueId = null, withRounds = true } = {}) {
  const cachedLeague = getLeagueSafe({});
  const cachedUsers = ensureArr(getUsers([]));
  const cachedRounds = ensureArr(getRounds([]));

  try {
    const activeId = await resolveLeagueIdSupabaseFirst({ preferredLeagueId: leagueId });

    if (!activeId) {
      return {
        league: cachedLeague?.id ? cachedLeague : null,
        users: cachedUsers,
        rounds: cachedRounds,
      };
    }

    await setActiveLeagueId(activeId);

    const leagueRow = await fetchLeagueById(activeId);
    const members = await fetchLeagueMembers(activeId);
    const memberIds = ensureArr(members).map((m) => m.user_id).filter(Boolean);
    const profiles = await fetchProfilesByIds(memberIds);

    const users = profiles.map((p) => ({
      id: p.id,
      name: p.display_name || (p.email ? p.email.split("@")[0] : "Golfer"),
      email: p.email || null,
    }));

    // UI cache only — DO NOT use for permissions
    const memberRoles = {};
    members.forEach((m) => {
      if (!m?.user_id) return;
      memberRoles[m.user_id] = normalizeRole(m.role);
    });

    const nextLeague = normalizeLeague({
      id: leagueRow?.id,
      name: leagueRow?.name || "League",
      host_user_id: leagueRow?.host_user_id || null,
      members: memberIds,
      memberRoles,
      pointsSystem: leagueRow?.points_system || null,
      seasonStartISO: cachedLeague?.seasonStartISO || new Date().toISOString(),
      seasonEndISO: cachedLeague?.seasonEndISO || null,
    });

    setLeagueSafe(nextLeague);
    setUsers(users);

    let rounds = cachedRounds;
    if (withRounds) rounds = await syncRoundsFromSupabase({ leagueId: activeId });

    return { league: nextLeague, users, rounds };
  } catch {
    return {
      league: cachedLeague?.id ? cachedLeague : null,
      users: cachedUsers,
      rounds: cachedRounds,
    };
  }
}

export const syncActiveLeagueFromSupabaseHydrate = syncActiveLeagueFromSupabase;

/* ---------------------------------------------
   POINTS CALC HELPERS (pure)
---------------------------------------------- */
export function calculateLeaguePoints({ place = null, bonusFlags = {}, played = true, pointsSystem = null } = {}) {
  const ps = normalizePointsSystem(pointsSystem || getPointsSystem(DEFAULT_POINTS_SYSTEM));
  const p = toInt(place, NaN);

  const placementPoints = Number.isFinite(p) && p > 0 ? toInt(ps.placementPoints[p], 0) : 0;
  const participationPoints = played && ps.participation?.enabled ? toInt(ps.participation.points, 0) : 0;

  let bonusPoints = 0;
  const flags = ensureObj(bonusFlags);

  if (ps.bonuses?.enabled) {
    if (ps.bonuses.birdie?.enabled && Boolean(flags.birdie)) bonusPoints += toInt(ps.bonuses.birdie.points, 0);
    if (ps.bonuses.eagle?.enabled && Boolean(flags.eagle)) bonusPoints += toInt(ps.bonuses.eagle.points, 0);
    if (ps.bonuses.hio?.enabled && Boolean(flags.hio)) bonusPoints += toInt(ps.bonuses.hio.points, 0);
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

  const nextBadge = { ...badge, earnedAt: badge?.earnedAt || new Date().toISOString() };
  setBadges({ ...all, [playerId]: [nextBadge, ...existing] });
  return true;
}

export function awardTrophy(playerId, trophy) {
  const all = getTrophiesMap();
  const existing = ensureArr(all[playerId]);
  const already = existing.some((t) => t?.key === trophy?.key);
  if (already) return false;

  const nextTrophy = { ...trophy, earnedAt: trophy?.earnedAt || new Date().toISOString() };
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

/* ---------------------------------------------
   Legacy cached role helpers (UI only - DO NOT USE FOR PERMISSIONS)
---------------------------------------------- */
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
  const nextRoles = { ...roles, [userId]: normalizeRole(role) };
  const nextLeague = { ...league, memberRoles: nextRoles };
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

