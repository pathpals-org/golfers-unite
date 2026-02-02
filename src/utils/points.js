// src/utils/points.js

/**
 * Golfers Unite — points engine
 *
 * This file MUST support:
 * ✅ New league.pointsSystem shape (your Points Settings UI):
 * {
 *   placementPoints: { 1: 3, 2: 2, 3: 0, ... },
 *   participation: { enabled: false, points: 1 },
 *   bonuses: {
 *     enabled: false,
 *     birdie: { enabled: false, points: 1 },
 *     eagle:  { enabled: false, points: 2 },
 *     hio:    { enabled: false, points: 5 }
 *   }
 * }
 *
 * ✅ Older/legacy flat shapes (so nothing breaks if old data exists).
 *
 * IMPORTANT REALITY:
 * - Placement points (1st/2nd/3rd) require comparing all rounds in the same “event”.
 * - That event-level ranking is already handled in SubmitRound (recomputePlacementPointsForEvent)
 *   and stored onto each round as:
 *   round.points and round.pointsBreakdown = { mode:"placement", rank, ... }
 *
 * Therefore:
 * - League standings should mostly trust round.points if present (stats.js already does).
 * - BUT we still allow recompute from a single round IF it has a saved rank / finishPosition.
 */

/* ---------------------------- utils ---------------------------- */

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(n, min, max) {
  const x = Number.isFinite(n) ? n : parseInt(n, 10);
  if (!Number.isFinite(x)) return min;
  return Math.min(max, Math.max(min, x));
}

function ensureObj(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

function ensureBool(v, fallback = false) {
  if (typeof v === "boolean") return v;
  return fallback;
}

function normalizePlacementMap(mapLike) {
  const raw = ensureObj(mapLike);
  const out = {};
  Object.keys(raw).forEach((k) => {
    const place = Math.trunc(num(k, NaN));
    if (!Number.isFinite(place) || place <= 0) return;
    out[place] = Math.trunc(num(raw[k], 0));
  });
  return out;
}

/* ---------------------------- normalize ---------------------------- */

/**
 * Normalizes any points config into a stable internal shape.
 * Supports:
 * - NEW pointsSystem object (placementPoints + participation + bonuses)
 * - OLD legacy/performance objects (baseRound + birdie/eagle/hio + majorMultiplier etc)
 * - Flat “match day” keys (first/second/third) etc
 */
export function normalizePointsRules(rules = {}) {
  const r = ensureObj(rules);

  // Detect new placement system
  const hasPlacementPoints =
    r.placementPoints !== undefined ||
    r.placement !== undefined ||
    r.positions !== undefined;

  if (hasPlacementPoints) {
    const placementPoints = normalizePlacementMap(
      r.placementPoints ?? r.placement ?? r.positions
    );

    const participationObj = ensureObj(r.participation);
    const bonusesObj = ensureObj(r.bonuses);

    const birdieObj = ensureObj(bonusesObj.birdie);
    const eagleObj = ensureObj(bonusesObj.eagle);
    const hioObj = ensureObj(bonusesObj.hio);

    // Fallbacks if someone stored a partial config
    const safePlacement =
      Object.keys(placementPoints).length > 0 ? placementPoints : { 1: 3, 2: 2, 3: 0 };

    return {
      mode: "placement",
      placementPoints: safePlacement,
      participation: {
        enabled: ensureBool(participationObj.enabled, false),
        points: Math.trunc(num(participationObj.points, 1)),
      },
      bonuses: {
        enabled: ensureBool(bonusesObj.enabled, false),
        birdie: {
          enabled: ensureBool(birdieObj.enabled, false),
          points: Math.trunc(num(birdieObj.points, 1)),
        },
        eagle: {
          enabled: ensureBool(eagleObj.enabled, false),
          points: Math.trunc(num(eagleObj.points, 2)),
        },
        hio: {
          enabled: ensureBool(hioObj.enabled, false),
          points: Math.trunc(num(hioObj.points, 5)),
        },
      },
    };
  }

  // ---------------- legacy/performance ----------------
  // Core (old naming)
  const participationPoints = num(
    r.participationPoints ??
      r.baseRound ??
      r.base ??
      r.round ??
      r.perRound,
    10
  );

  // Finishing position (optional match-day mode)
  const winPoints = num(r.winPoints ?? r.firstPoints ?? r.first ?? r.win, 0);
  const secondPoints = num(r.secondPoints ?? r.runnerUpPoints ?? r.second ?? r.p2, 0);
  const thirdPoints = num(r.thirdPoints ?? r.third ?? r.p3, 0);

  // Scoring events
  const birdiePoints = num(r.birdiePoints ?? r.birdie ?? r.birdies, 2);
  const eaglePoints = num(r.eaglePoints ?? r.eagle ?? r.eagles, 5);
  const hioPoints = num(r.hioPoints ?? r.hio ?? r.holeInOne ?? r.hole_in_one, 20);

  // Bonuses (optional)
  const underParBonus = num(r.underParBonus ?? r.bonusUnderPar ?? r.under_par_bonus, 10);
  const break80Bonus = num(r.break80Bonus ?? r.bonusBreak80 ?? r.break_80_bonus, 5);

  // Major multiplier
  const majorMultiplier = num(r.majorMultiplier ?? r.multiplier ?? r.major_multiplier, 2);

  return {
    mode: "legacy",
    participationPoints,
    winPoints,
    secondPoints,
    thirdPoints,
    birdiePoints,
    eaglePoints,
    hioPoints,
    underParBonus,
    break80Bonus,
    majorMultiplier,
  };
}

/* ---------------------------- helpers ---------------------------- */

function placementPointsForPosition(pos, placementMap) {
  const p = Math.trunc(num(pos, NaN));
  if (!Number.isFinite(p) || p <= 0) return 0;
  const map = normalizePlacementMap(placementMap);
  return Math.trunc(num(map[p], 0));
}

function getRankFromRound(round) {
  // SubmitRound stores pointsBreakdown.rank for placement mode
  const pb = round?.pointsBreakdown && typeof round.pointsBreakdown === "object" ? round.pointsBreakdown : null;
  const rankFromBreakdown = pb && pb.rank !== undefined ? num(pb.rank, NaN) : NaN;

  // fallback to other common names
  const rank =
    Number.isFinite(rankFromBreakdown)
      ? rankFromBreakdown
      : num(round?.finishPosition ?? round?.position ?? round?.rank, NaN);

  return Number.isFinite(rank) ? Math.trunc(rank) : null;
}

/* ---------------------------- computePoints (match/event) ---------------------------- */

/**
 * Match / event style (finish position driven).
 * Preserves existing signature so nothing else breaks.
 */
export function computePoints({
  finishPosition,
  birdies = 0,
  eagles = 0,
  holeInOnes = 0,
  isMajor = false,
  rules,
  majorMultiplier = 1,
}) {
  const R = normalizePointsRules(rules);

  // NEW placement system
  if (R.mode === "placement") {
    let points = 0;

    if (R.participation.enabled) points += Math.trunc(num(R.participation.points, 1));

    points += placementPointsForPosition(finishPosition, R.placementPoints);

    if (R.bonuses.enabled) {
      if (R.bonuses.birdie.enabled) points += clampInt(birdies, 0, 99) * Math.trunc(num(R.bonuses.birdie.points, 1));
      if (R.bonuses.eagle.enabled) points += clampInt(eagles, 0, 99) * Math.trunc(num(R.bonuses.eagle.points, 2));
      if (R.bonuses.hio.enabled) points += clampInt(holeInOnes, 0, 18) * Math.trunc(num(R.bonuses.hio.points, 5));
    }

    // In the new placement system we are NOT applying major multipliers (by design in your MVP).
    // If you ever add it later, we can wire it here.
    return Math.round(points);
  }

  // LEGACY system
  let points = R.participationPoints;

  if (finishPosition === 1) points += R.winPoints;
  if (finishPosition === 2) points += R.secondPoints;
  if (finishPosition === 3) points += R.thirdPoints;

  points += clampInt(birdies, 0, 99) * R.birdiePoints;
  points += clampInt(eagles, 0, 99) * R.eaglePoints;
  points += clampInt(holeInOnes, 0, 18) * R.hioPoints;

  if (isMajor) {
    const mult = num(majorMultiplier, 0) || R.majorMultiplier || 1;
    points *= mult;
  }

  return Math.round(points);
}

/* ---------------------------- computeRoundPoints (round submission) ---------------------------- */

/**
 * Round submission style.
 * Used by stats.js when a round does NOT already include points.
 *
 * For placement mode:
 * - We can only compute placement points if the round has a known rank / finishPosition saved.
 * - Otherwise we award 0 placement points (but still can apply participation/bonuses if enabled).
 */
export function computeRoundPoints(round, rules) {
  const R = normalizePointsRules(rules);

  // NEW placement system
  if (R.mode === "placement") {
    const birdies = clampInt(num(round?.birdies, 0), 0, 99);
    const eagles = clampInt(num(round?.eagles, 0), 0, 99);
    const hio = clampInt(num(round?.hio, 0), 0, 18);

    const rank = getRankFromRound(round);
    const placementBase = rank ? placementPointsForPosition(rank, R.placementPoints) : 0;

    const participationBase = R.participation.enabled
      ? Math.trunc(num(R.participation.points, 1))
      : 0;

    let extras = 0;
    if (R.bonuses.enabled) {
      if (R.bonuses.birdie.enabled) extras += birdies * Math.trunc(num(R.bonuses.birdie.points, 1));
      if (R.bonuses.eagle.enabled) extras += eagles * Math.trunc(num(R.bonuses.eagle.points, 2));
      if (R.bonuses.hio.enabled) extras += hio * Math.trunc(num(R.bonuses.hio.points, 5));
    }

    const total = Math.round(participationBase + placementBase + extras);

    return {
      total,
      breakdown: {
        mode: "placement",
        rank: rank ?? null,
        participationEnabled: Boolean(R.participation.enabled),
        participationPoints: participationBase,
        placementPoints: placementBase,
        bonusesEnabled: Boolean(R.bonuses.enabled),
        birdies,
        eagles,
        hio,
        extras,
      },
    };
  }

  // LEGACY system
  const birdies = clampInt(num(round?.birdies, 0), 0, 99);
  const eagles = clampInt(num(round?.eagles, 0), 0, 99);
  const hio = clampInt(num(round?.hio, 0), 0, 18);

  const grossScore = num(round?.grossScore, NaN);
  const par = num(round?.par, NaN);

  const base = R.participationPoints;
  const extras = birdies * R.birdiePoints + eagles * R.eaglePoints + hio * R.hioPoints;

  const diff =
    Number.isFinite(grossScore) && Number.isFinite(par) ? grossScore - par : null;
  const underParBonus = diff !== null && diff < 0 ? R.underParBonus : 0;
  const break80Bonus = Number.isFinite(grossScore) && grossScore < 80 ? R.break80Bonus : 0;

  const preMultiplier = base + extras + underParBonus + break80Bonus;

  const isMajor = Boolean(round?.isMajor);
  const mult = isMajor ? (num(round?.majorMultiplier, 0) || R.majorMultiplier || 1) : 1;

  const total = Math.round(preMultiplier * mult);

  return {
    total,
    breakdown: {
      mode: "legacy",
      base,
      birdies,
      eagles,
      hio,
      extras,
      underParBonus,
      break80Bonus,
      multiplier: mult,
      preMultiplier,
    },
  };
}


