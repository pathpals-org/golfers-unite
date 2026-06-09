// src/utils/stats.js
import { calculateLeaguePoints, DEFAULT_POINTS_SYSTEM } from "./storage";

/**
 * Golfers Unite — standings builder
 *
 * Supports both:
 * - old/localStorage round shape: playerId, date, course, grossScore, points, birdies
 * - Supabase round shape: user_id, played_on, course_name, gross_score, points_awarded, bonus
 */

function ensureArr(v) {
  return Array.isArray(v) ? v : [];
}

function ensureObj(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function getRoundBonus(r) {
  return ensureObj(r?.bonus);
}

function getRoundUserId(r) {
  return (
    r?.playerId ||
    r?.userId ||
    r?.userID ||
    r?.uid ||
    r?.user_id ||
    null
  );
}

function getRoundLeagueId(r) {
  return r?.leagueId || r?.league_id || "no_league";
}

function getRoundCourse(r) {
  return r?.course || r?.course_name || "";
}

function getRoundHoles(r) {
  const bonus = getRoundBonus(r);
  return n(r?.holes ?? bonus.holes, 18);
}

function getRoundBirdies(r) {
  const bonus = getRoundBonus(r);
  return n(r?.birdies ?? bonus.birdies, 0);
}

function getRoundEagles(r) {
  const bonus = getRoundBonus(r);
  return n(r?.eagles ?? bonus.eagles, 0);
}

function getRoundHio(r) {
  const bonus = getRoundBonus(r);

  if (r?.hio !== undefined) return n(r.hio, 0);
  if (r?.holeInOnes !== undefined) return n(r.holeInOnes, 0);
  if (bonus.hio !== undefined) return n(bonus.hio, 0);

  return 0;
}

function getRoundIsMajor(r) {
  const bonus = getRoundBonus(r);
  return Boolean(r?.isMajor ?? r?.is_major ?? bonus.isMajor);
}

function getStoredRoundPoints(r) {
  if (r?.points !== undefined) return n(r.points, 0);
  if (r?.points_awarded !== undefined) return n(r.points_awarded, 0);
  if (r?.pointsAwarded !== undefined) return n(r.pointsAwarded, 0);
  if (r?.pointsEarned !== undefined) return n(r.pointsEarned, 0);
  return null;
}

function getDateISOKey(r) {
  const raw = r?.date || r?.played_on || r?.createdAt || r?.created_at || "";
  const s = String(raw || "");

  if (s.length >= 10 && s[4] === "-" && s[7] === "-") {
    return s.slice(0, 10);
  }

  return s;
}

/**
 * Event key:
 * leagueId + date + course + holes
 */
function getEventKey(r) {
  const leagueId = getRoundLeagueId(r);
  const date = getDateISOKey(r) || "no_date";
  const course = String(getRoundCourse(r)).trim().toLowerCase() || "no_course";
  const holes = String(getRoundHoles(r) || 18);

  return `${leagueId}::${date}::${course}::${holes}`;
}

/**
 * Ranking value getters.
 * medal: lower is better.
 * stableford/handicap: higher is better.
 */
function getMedalValue(r) {
  if (r?.grossScore !== undefined) return n(r.grossScore, Infinity);
  if (r?.gross_score !== undefined) return n(r.gross_score, Infinity);
  if (r?.score !== undefined) return n(r.score, Infinity);
  return Infinity;
}

function getStablefordValue(r) {
  if (r?.stablefordPoints !== undefined) return n(r.stablefordPoints, -Infinity);
  if (r?.stableford !== undefined) return n(r.stableford, -Infinity);
  return -Infinity;
}

function getHandicapValue(r) {
  if (r?.vsHandicap !== undefined) return n(r.vsHandicap, -Infinity);
  if (r?.handicapDelta !== undefined) return n(r.handicapDelta, -Infinity);
  return -Infinity;
}

function getMode(pointsSystem) {
  const ps = ensureObj(pointsSystem);
  const m = ps?.mode;

  return m === "stableford" || m === "handicap" || m === "medal"
    ? m
    : DEFAULT_POINTS_SYSTEM.mode;
}

function getPlacementTable(pointsSystem) {
  const ps = ensureObj(pointsSystem);
  const tbl = ensureObj(ps?.placementPoints);

  return Object.keys(tbl).length ? tbl : DEFAULT_POINTS_SYSTEM.placementPoints;
}

function canDoPlacementScoring(pointsSystem, rounds) {
  const ps = ensureObj(pointsSystem);
  const placementPoints = getPlacementTable(ps);
  const hasPlacementTable = Object.keys(placementPoints).length > 0;

  if (!hasPlacementTable) return false;

  const mode = getMode(ps);
  const rs = ensureArr(rounds);

  if (mode === "stableford") {
    return rs.some((r) => {
      const val = getStablefordValue(r);
      return Number.isFinite(val) && val !== -Infinity;
    });
  }

  if (mode === "handicap") {
    return rs.some((r) => {
      const val = getHandicapValue(r);
      return Number.isFinite(val) && val !== -Infinity;
    });
  }

  return rs.some((r) => {
    const val = getMedalValue(r);
    return Number.isFinite(val) && val !== Infinity;
  });
}

function sortGroupForRanking(groupRounds, mode) {
  const list = ensureArr(groupRounds).slice();

  if (mode === "stableford") {
    return list.sort((a, b) => getStablefordValue(b) - getStablefordValue(a));
  }

  if (mode === "handicap") {
    return list.sort((a, b) => getHandicapValue(b) - getHandicapValue(a));
  }

  return list.sort((a, b) => getMedalValue(a) - getMedalValue(b));
}

function sameRankValue(a, b, mode) {
  if (mode === "stableford") return getStablefordValue(a) === getStablefordValue(b);
  if (mode === "handicap") return getHandicapValue(a) === getHandicapValue(b);
  return getMedalValue(a) === getMedalValue(b);
}

function groupByEvent(rounds) {
  const map = new Map();

  ensureArr(rounds).forEach((r) => {
    const k = getEventKey(r);

    if (!map.has(k)) {
      map.set(k, []);
    }

    map.get(k).push(r);
  });

  return map;
}

/**
 * Computes placement points per round.
 */
function computePlacementPointsMap(rounds, pointsSystem) {
  const rs = ensureArr(rounds);
  const ps = ensureObj(pointsSystem);

  const mode = getMode(ps);
  const placementPoints = getPlacementTable(ps);

  const byEvent = groupByEvent(rs);
  const pointsById = new Map();
  const breakdownById = new Map();

  const fallbackId = (r, idx) =>
    String(
      r?.id ||
        r?._id ||
        `${getRoundUserId(r) || "u"}__${getEventKey(r)}__${idx}`
    );

  const originalIndex = new Map();
  rs.forEach((r, idx) => originalIndex.set(r, idx));

  byEvent.forEach((eventRounds) => {
    const sorted = sortGroupForRanking(eventRounds, mode);

    let place = 1;

    for (let i = 0; i < sorted.length; i++) {
      if (i > 0 && !sameRankValue(sorted[i], sorted[i - 1], mode)) {
        place = i + 1;
      }

      const r = sorted[i];
      const idx = originalIndex.get(r) ?? i;
      const idKey = fallbackId(r, idx);

      const bonusFlags = {
        birdie: getRoundBirdies(r) > 0,
        eagle: getRoundEagles(r) > 0,
        hio: getRoundHio(r) > 0,
      };

      const computed = calculateLeaguePoints({
        place,
        bonusFlags,
        played: true,
        pointsSystem: {
          ...DEFAULT_POINTS_SYSTEM,
          ...ps,
          placementPoints,
        },
      });

      const total = n(computed?.totalPoints, 0);

      pointsById.set(idKey, total);

      breakdownById.set(idKey, {
        mode: "league",
        rank: place,
        placementPoints: n(computed?.placementPoints, 0),
        participationPoints: n(computed?.participationPoints, 0),
        bonusPoints: n(computed?.bonusPoints, 0),
        totalPoints: total,
      });
    }
  });

  return {
    pointsById,
    breakdownById,
    idKey: fallbackId,
  };
}

/**
 * Builds standings for the League page.
 *
 * @param {Array} users
 * @param {Array} rounds
 * @param {Object} pointsSystem
 */
export function buildStandings(users, rounds, pointsSystem = null) {
  const u = ensureArr(users);
  const rs = ensureArr(rounds);

  const ps =
    ensureObj(pointsSystem) && Object.keys(pointsSystem || {}).length
      ? pointsSystem
      : DEFAULT_POINTS_SYSTEM;

  const usePlacement = canDoPlacementScoring(ps, rs);
  const placementResult = usePlacement ? computePlacementPointsMap(rs, ps) : null;

  const table = {};

  u.forEach((player) => {
    const id = player?.id || player?._id;

    if (!id) return;

    table[id] = {
      userId: id,
      name:
        player?.name ||
        player?.fullName ||
        player?.displayName ||
        player?.display_name ||
        player?.username ||
        "Unnamed",
      points: 0,
      rounds: 0,
      majors: 0,
      birdies: 0,
      eagles: 0,
      hio: 0,
      last5: [],
    };
  });

  const sortedRounds = [...rs].sort((a, b) => {
    const ad = String(getDateISOKey(a));
    const bd = String(getDateISOKey(b));

    if (ad > bd) return -1;
    if (ad < bd) return 1;

    return 0;
  });

  sortedRounds.forEach((r, idx) => {
    const uid = getRoundUserId(r);
    const row = table[uid];

    if (!row) return;

    let earned = 0;

    /**
     * Prefer live placement calculation when possible.
     *
     * This means the table will still show correct standings even if old
     * rows have stale stored points.
     */
    if (usePlacement && placementResult) {
      const key = placementResult.idKey(r, idx);
      earned = n(placementResult.pointsById.get(key), 0);
    } else {
      const stored = getStoredRoundPoints(r);

      if (stored !== null) {
        earned = stored;
      } else {
        const bonusFlags = {
          birdie: getRoundBirdies(r) > 0,
          eagle: getRoundEagles(r) > 0,
          hio: getRoundHio(r) > 0,
        };

        const computed = calculateLeaguePoints({
          place: null,
          bonusFlags,
          played: true,
          pointsSystem: ps,
        });

        earned = n(computed?.totalPoints, 0);
      }
    }

    row.points += earned;
    row.rounds += 1;

    row.birdies += getRoundBirdies(r);
    row.eagles += getRoundEagles(r);
    row.hio += getRoundHio(r);

    if (getRoundIsMajor(r)) {
      row.majors += 1;
    }

    if (row.last5.length < 5) {
      row.last5.push({
        points: earned,
        isMajor: getRoundIsMajor(r),
        date: getDateISOKey(r) || "",
      });
    }
  });

  return Object.values(table).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.rounds !== a.rounds) return b.rounds - a.rounds;
    return String(a.name).localeCompare(String(b.name));
  });
}

export function buildPlayerStats(userId, users, rounds, pointsSystem = null) {
  const standings = buildStandings(users, rounds, pointsSystem);
  const row = standings.find((r) => r.userId === userId) || null;

  const rs = ensureArr(rounds).filter((r) => getRoundUserId(r) === userId);

  const recent = [...rs].sort((a, b) => {
    const ad = String(getDateISOKey(a));
    const bd = String(getDateISOKey(b));

    if (ad > bd) return -1;
    if (ad < bd) return 1;

    return 0;
  });

  return {
    row,
    recentRounds: recent.slice(0, 10),
  };
}