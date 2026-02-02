// src/pages/SubmitRound.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import Card from "../components/ui/Card";
import PageHeader from "../components/ui/PageHeader";
import EmptyState from "../components/ui/EmptyState";

import {
  KEYS,
  get,
  set,
  getLeague,
  setLeague,
  getUsers,
  getRounds,
  getPointsSystem,
  getBadges,
  getTrophiesMap,
  setBadges,
  setTrophiesMap,
  calculateLeaguePoints,
  DEFAULT_POINTS_SYSTEM,
} from "../utils/storage";

const CURRENT_USER_KEY = "currentUserId";

function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function safeUUID(prefix = "id") {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // ignore
  }
  return uid(prefix);
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function clampInt(n, min, max) {
  const x = Number.isFinite(n) ? n : parseInt(n, 10);
  if (!Number.isFinite(x)) return min;
  return Math.min(max, Math.max(min, x));
}

function ensureArray(v) {
  return Array.isArray(v) ? v : [];
}

function ensureObj(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

function awardIfMissing(list, award) {
  const exists = list.some((a) => a?.key === award.key);
  if (exists) return list;
  return [award, ...list];
}

function computeAwardsForRound({ round, previousRoundsForPlayer }) {
  const badges = [];
  const trophies = [];

  const prevCount = previousRoundsForPlayer.length;
  const isFirstRound = prevCount === 0;

  if (isFirstRound) {
    badges.push({
      key: "badge_first_round",
      title: "First Round",
      desc: "Submitted your first round.",
      icon: "🏁",
    });
  }

  if ((round.birdies || 0) > 0) {
    badges.push({
      key: "badge_first_birdie",
      title: "First Birdie",
      desc: "Logged a birdie in a submitted round.",
      icon: "🐦",
    });
  }

  if ((round.eagles || 0) > 0) {
    trophies.push({
      key: "trophy_eagle_club",
      title: "Eagle Club",
      desc: "Logged an eagle in a submitted round.",
      icon: "🦅",
    });
  }

  if ((round.hio || 0) > 0) {
    trophies.push({
      key: "trophy_hole_in_one",
      title: "Hole in One",
      desc: "Aces are forever.",
      icon: "⛳️",
    });
  }

  const gross = Number(round.grossScore);
  const par = Number(round.par);
  const diff = Number.isFinite(gross) && Number.isFinite(par) ? gross - par : null;

  if (Number.isFinite(gross) && gross < 90) {
    badges.push({
      key: "badge_break_90",
      title: "Break 90",
      desc: "Shot under 90.",
      icon: "🔥",
    });
  }

  if (Number.isFinite(gross) && gross < 80) {
    trophies.push({
      key: "trophy_break_80",
      title: "Break 80",
      desc: "That’s a proper score.",
      icon: "🏆",
    });
  }

  if (diff !== null && diff <= 0) {
    trophies.push({
      key: "trophy_par_or_better",
      title: "Par or Better",
      desc: "Finished level par or better.",
      icon: "⭐️",
    });
  }

  if ((round.birdies || 0) >= 5) {
    trophies.push({
      key: "trophy_birdie_fest",
      title: "Birdie Fest",
      desc: "5+ birdies in one round.",
      icon: "🎉",
    });
  }

  if (round.isMajor) {
    badges.push({
      key: "badge_major_day",
      title: "Major Day",
      desc: "Submitted a Major round.",
      icon: "🏟️",
    });
  }

  return { badges, trophies };
}

function getPlayerLabel(p) {
  if (!p) return "Unknown";
  return p.name || p.fullName || p.displayName || p.username || "Unnamed Player";
}

function Pill({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-full px-3 py-1.5 text-xs font-extrabold ring-1 transition",
        active
          ? "bg-emerald-600 text-white ring-emerald-600"
          : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/**
 * Image compression (no libraries)
 * - Resize longest side to maxDim
 * - Encode to JPEG at quality
 * Returns: dataURL ("data:image/jpeg;base64,...")
 */
async function compressImageToDataURL(file, { maxDim = 1280, quality = 0.78 } = {}) {
  if (!file) return null;

  const blobUrl = URL.createObjectURL(file);

  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = blobUrl;
    });

    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;

    if (!w || !h) return null;

    const scale = Math.min(1, maxDim / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;

    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.drawImage(img, 0, 0, tw, th);

    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/**
 * Event key for placement ranking
 * (same leagueId + date + course + holes)
 */
function makeEventKey({ leagueId, date, course, holes }) {
  return [
    leagueId || "no_league",
    date || "no_date",
    (course || "").trim().toLowerCase(),
    String(holes || 18),
  ].join("::");
}

/**
 * Rank within an event (ties share same rank).
 * Medal mode: lower grossScore is better.
 * Competition ranking: 1,1,3...
 */
function rankForGrossScore(eventRounds, grossScore) {
  const s = Number(grossScore);
  if (!Number.isFinite(s)) return null;

  const scores = ensureArray(eventRounds)
    .map((r) => Number(r.grossScore))
    .filter((x) => Number.isFinite(x))
    .sort((a, b) => a - b);

  if (!scores.length) return null;

  const distinctLower = new Set(scores.filter((x) => x < s));
  return distinctLower.size + 1;
}

/**
 * ✅ IMPORTANT: recompute placement points for everyone in the event
 * so earlier submitters get updated if someone beats them later.
 */
function recomputeEventPoints(allRounds, { leagueId, date, course, holes, pointsSystem }) {
  const eventKey = makeEventKey({ leagueId, date, course, holes });

  const eventRounds = allRounds.filter((r) => {
    const k = makeEventKey({
      leagueId: r.leagueId || null,
      date: r.date,
      course: r.course,
      holes: r.holes,
    });
    return k === eventKey;
  });

  if (!eventRounds.length) return allRounds;

  const updated = allRounds.map((r) => {
    const k = makeEventKey({
      leagueId: r.leagueId || null,
      date: r.date,
      course: r.course,
      holes: r.holes,
    });
    if (k !== eventKey) return r;

    const rank = rankForGrossScore(eventRounds, r.grossScore);

    const bonusFlags = {
      birdie: Number(r.birdies) > 0,
      eagle: Number(r.eagles) > 0,
      hio: Number(r.hio) > 0,
    };

    const res = calculateLeaguePoints({
      place: rank,
      bonusFlags,
      played: true,
      pointsSystem: pointsSystem || DEFAULT_POINTS_SYSTEM,
    });

    return {
      ...r,
      points: res.totalPoints,
      pointsBreakdown: {
        mode: "league",
        rank,
        placementPoints: res.placementPoints,
        bonusPoints: res.bonusPoints,
        participationPoints: res.participationPoints,
      },
    };
  });

  return updated;
}

export default function SubmitRound() {
  const navigate = useNavigate();

  const [players, setPlayers] = useState([]);
  const [pointsSystem, setPointsSystemState] = useState(null);
  const [league, setLeagueState] = useState(() => getLeague(null));

  // "Current user" (MVP identity)
  const [currentUserId, setCurrentUserId] = useState(() => {
    try {
      return localStorage.getItem(CURRENT_USER_KEY) || "";
    } catch {
      return "";
    }
  });

  const [toast, setToast] = useState(null);
  const [touched, setTouched] = useState({});
  const [saving, setSaving] = useState(false);

  // ✅ optional feed post
  const [createPost, setCreatePost] = useState(true);
  const [postToPublic, setPostToPublic] = useState(true);
  const [postToFriends, setPostToFriends] = useState(false);
  const [postToLeague, setPostToLeague] = useState(true);

  // Scorecard photo (compressed)
  const [cardPhoto, setCardPhoto] = useState(null);
  const [compressing, setCompressing] = useState(false);

  const [form, setForm] = useState(() => ({
    date: todayISO(),
    playerId: "",
    course: "",
    holes: 18,
    par: 72,
    grossScore: "",
    birdies: 0,
    eagles: 0,
    hio: 0,
    isMajor: false,
    notes: "",
  }));

  useEffect(() => {
    const loadedPlayers = ensureArray(getUsers([]));
    setPlayers(loadedPlayers);

    const loadedPoints = getPointsSystem(null);
    setPointsSystemState(loadedPoints);

    const lg = getLeague(null);

    // ✅ Ensure league has a hostId AND persist it
    if (lg && !lg.hostId) {
      const firstUser = loadedPlayers[0]?.id || loadedPlayers[0]?._id || "";
      const next = { ...lg, hostId: firstUser || "" };
      setLeague(next);
      setLeagueState(next);
    } else {
      setLeagueState(lg);
    }

    // Default current user if missing
    if (!currentUserId && loadedPlayers.length) {
      const first = loadedPlayers[0]?.id || loadedPlayers[0]?._id || "";
      if (first) {
        try {
          localStorage.setItem(CURRENT_USER_KEY, first);
        } catch {
          // ignore
        }
        setCurrentUserId(first);
      }
    }

    // Default playerId to current user
    const resolvedUserId =
      (currentUserId || "").trim() || (loadedPlayers[0]?.id || loadedPlayers[0]?._id || "");

    if (!form.playerId && resolvedUserId) {
      setForm((f) => ({ ...f, playerId: resolvedUserId }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep form playerId aligned to current user unless host is editing
  useEffect(() => {
    if (!currentUserId) return;
    const host = league?.hostId && league.hostId === currentUserId;
    if (host) return;
    setForm((f) => (f.playerId === currentUserId ? f : { ...f, playerId: currentUserId }));
  }, [currentUserId, league?.hostId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const currentUser = useMemo(() => {
    if (!currentUserId) return null;
    return players.find((p) => p.id === currentUserId || p._id === currentUserId) || null;
  }, [players, currentUserId]);

  const selectedPlayer = useMemo(() => {
    const id = form.playerId;
    return players.find((p) => p.id === id || p._id === id) || null;
  }, [players, form.playerId]);

  const isHost = Boolean(currentUserId && league?.hostId && league.hostId === currentUserId);

  const leaguePointsSystem = useMemo(() => {
    const ps = league?.pointsSystem ? ensureObj(league.pointsSystem) : null;
    return ps && Object.keys(ps).length ? ps : null;
  }, [league?.pointsSystem]);

  const usingNewPoints = Boolean(leaguePointsSystem);

  const computed = useMemo(() => {
    const gross = form.grossScore === "" ? NaN : Number(form.grossScore);
    const par = Number(form.par);
    const diff = Number.isFinite(gross) && Number.isFinite(par) ? gross - par : null;

    if (usingNewPoints) {
      const allRounds = ensureArray(getRounds([]));
      const draft = {
        id: "__draft__",
        leagueId: league?.id || null,
        date: form.date,
        course: form.course.trim(),
        holes: Number(form.holes),
        grossScore: gross,
        birdies: clampInt(Number(form.birdies), 0, 99),
        eagles: clampInt(Number(form.eagles), 0, 99),
        hio: clampInt(Number(form.hio), 0, 18),
      };

      const eventKey = makeEventKey({
        leagueId: draft.leagueId,
        date: draft.date,
        course: draft.course,
        holes: draft.holes,
      });

      const eventRounds = allRounds.filter((r) => {
        const k = makeEventKey({
          leagueId: r.leagueId || null,
          date: r.date,
          course: r.course,
          holes: r.holes,
        });
        return k === eventKey;
      });

      const tempRounds =
        Number.isFinite(gross) && draft.course && draft.date ? [...eventRounds, draft] : eventRounds;

      const rank = rankForGrossScore(tempRounds, draft.grossScore);

      const bonusFlags = {
        birdie: draft.birdies > 0,
        eagle: draft.eagles > 0,
        hio: draft.hio > 0,
      };

      const res = calculateLeaguePoints({
        place: rank,
        bonusFlags,
        played: true,
        pointsSystem: leaguePointsSystem || DEFAULT_POINTS_SYSTEM,
      });

      return {
        points: res.totalPoints,
        breakdown: {
          mode: "league",
          rank,
          placementPoints: res.placementPoints,
          bonusPoints: res.bonusPoints,
          participationPoints: res.participationPoints,
        },
        diff,
        netLabel: diff === null ? "—" : diff === 0 ? "E" : diff > 0 ? `+${diff}` : `${diff}`,
      };
    }

    // Legacy fallback preview
    const legacy = pointsSystem && typeof pointsSystem === "object" ? pointsSystem : null;

    const birdies = clampInt(Number(form.birdies), 0, 99);
    const eagles = clampInt(Number(form.eagles), 0, 99);
    const hio = clampInt(Number(form.hio), 0, 18);

    if (!legacy) {
      return {
        points: 0,
        breakdown: { mode: "legacy", note: "No points system set." },
        diff,
        netLabel: diff === null ? "—" : diff === 0 ? "E" : diff > 0 ? `+${diff}` : `${diff}`,
      };
    }

    const baseRound = Number(legacy.baseRound ?? 10) || 0;
    const birdiePts = Number(legacy.birdie ?? 2) || 0;
    const eaglePts = Number(legacy.eagle ?? 5) || 0;
    const hioPts = Number(legacy.hio ?? 20) || 0;
    const majorMultiplier = Number(legacy.majorMultiplier ?? 2) || 1;

    const preMult = baseRound + birdies * birdiePts + eagles * eaglePts + hio * hioPts;
    const total = Math.round(preMult * (form.isMajor ? majorMultiplier : 1));

    return {
      points: total,
      breakdown: { mode: "legacy", baseRound, extras: preMult - baseRound, multiplier: form.isMajor ? majorMultiplier : 1 },
      diff,
      netLabel: diff === null ? "—" : diff === 0 ? "E" : diff > 0 ? `+${diff}` : `${diff}`,
    };
  }, [form, league?.id, leaguePointsSystem, usingNewPoints, pointsSystem]);

  const errors = useMemo(() => {
    const e = {};

    if (!currentUserId) e.currentUserId = "Pick who you are (top card).";
    if (!form.playerId) e.playerId = "Pick a player.";
    if (!form.date) e.date = "Pick a date.";
    if (!form.course.trim()) e.course = "Course name is required.";

    const gross = Number(form.grossScore);
    if (!Number.isFinite(gross) || form.grossScore === "") e.grossScore = "Enter a valid score.";

    const par = Number(form.par);
    if (!Number.isFinite(par) || par < 60 || par > 78) e.par = "Par must be between 60 and 78.";

    const holes = Number(form.holes);
    if (![9, 18].includes(holes)) e.holes = "Holes must be 9 or 18.";

    const birdies = Number(form.birdies);
    const eagles = Number(form.eagles);
    const hio = Number(form.hio);

    if (!Number.isFinite(birdies) || birdies < 0) e.birdies = "Birdies must be 0 or more.";
    if (!Number.isFinite(eagles) || eagles < 0) e.eagles = "Eagles must be 0 or more.";
    if (!Number.isFinite(hio) || hio < 0) e.hio = "HIO must be 0 or more.";

    return e;
  }, [form, currentUserId]);

  const canSubmit = Object.keys(errors).length === 0 && !saving && !compressing;

  function update(name, value) {
    setForm((f) => ({ ...f, [name]: value }));
  }

  function markTouched(name) {
    setTouched((t) => ({ ...t, [name]: true }));
  }

  function pushFeedPost({ round, pointsAdded, pointsBreakdown }) {
    if (!createPost) return;

    const toPublic = postToPublic;
    const toFriends = postToFriends;
    const toLeague = postToLeague;

    if (!toPublic && !toFriends && !toLeague) return;

    const posts = ensureArray(get(KEYS.playPosts, []));

    const rank = pointsBreakdown?.rank;
    const modeLabel =
      typeof rank === "number"
        ? `(${rank}${rank === 1 ? "st" : rank === 2 ? "nd" : rank === 3 ? "rd" : "th"})`
        : "";

    const post = {
      id: safeUUID("post"),
      userId: round.playerId,
      leagueId: toLeague ? league?.id || null : null,
      createdAt: new Date().toISOString(),

      toPublic,
      toFriends,
      toLeague,

      text:
        round.notes?.trim() ||
        `${round.playerName} posted a round at ${round.course} — ${round.grossScore} (${computed.netLabel}). ${pointsAdded} pts ${modeLabel}`.trim(),
      score: {
        total: round.grossScore,
        birdies: round.birdies,
        eagles: round.eagles,
        hio: round.hio,
        points: pointsAdded,
        toPar: computed.netLabel,
        course: round.course,
        date: round.date,
        isMajor: round.isMajor,
      },
      media: null,
      likes: [],
      comments: [],
    };

    set(KEYS.playPosts, [post, ...posts]);
  }

  async function onPickScorecard(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type?.startsWith("image/")) {
      setToast({ type: "error", title: "Not an image", msg: "Please choose a photo from your camera roll." });
      return;
    }

    setCompressing(true);
    try {
      const dataUrl = await compressImageToDataURL(file, { maxDim: 1280, quality: 0.78 });
      if (!dataUrl) {
        setToast({ type: "error", title: "Couldn’t process image", msg: "Try a different photo." });
        return;
      }
      setCardPhoto(dataUrl);
      setToast({ type: "success", title: "Scorecard added", msg: "Saved as a lightweight photo for the round." });
    } catch {
      setToast({ type: "error", title: "Image failed", msg: "Try a different photo." });
    } finally {
      setCompressing(false);
      e.target.value = "";
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setTouched({
      currentUserId: true,
      date: true,
      playerId: true,
      course: true,
      holes: true,
      par: true,
      grossScore: true,
      birdies: true,
      eagles: true,
      hio: true,
    });

    if (!canSubmit) {
      setToast({ type: "error", title: "Fix the form", msg: "Please check the highlighted fields." });
      return;
    }

    setSaving(true);
    try {
      const allRoundsBefore = ensureArray(getRounds([]));

      // players submit THEIR OWN score; host can submit for others
      const playerId = isHost ? form.playerId : currentUserId;

      const prevRoundsForPlayer = allRoundsBefore.filter((r) => (r.playerId || r.userId) === playerId);

      const playerObj = players.find((p) => p.id === playerId || p._id === playerId);

      const baseRound = {
        id: uid("round"),
        createdAt: new Date().toISOString(),
        date: form.date,

        playerId,
        submittedBy: currentUserId,
        playerName: getPlayerLabel(playerObj),

        course: form.course.trim(),
        holes: Number(form.holes),
        par: Number(form.par),
        grossScore: Number(form.grossScore),
        birdies: clampInt(Number(form.birdies), 0, 99),
        eagles: clampInt(Number(form.eagles), 0, 99),
        hio: clampInt(Number(form.hio), 0, 18),
        isMajor: Boolean(form.isMajor),
        notes: form.notes.trim(),
        leagueId: league?.id || null,

        cardPhoto: cardPhoto || null,
        status: "approved",

        // ✅ save preview points (will be corrected when we recompute the event)
        points: Number(computed.points) || 0,
        pointsBreakdown: computed.breakdown || null,
      };

      // ✅ Add round newest-first manually so we can recompute & persist cleanly
      const allAfterAdd = [baseRound, ...allRoundsBefore];

      // ✅ If using new placement system, recompute everyone in this event and persist
      let finalAll = allAfterAdd;
      if (usingNewPoints) {
        finalAll = recomputeEventPoints(allAfterAdd, {
          leagueId: baseRound.leagueId || null,
          date: baseRound.date,
          course: baseRound.course,
          holes: baseRound.holes,
          pointsSystem: leaguePointsSystem || DEFAULT_POINTS_SYSTEM,
        });
      }

      // ✅ Persist rounds list
      set(KEYS.rounds, finalAll);

      // Pull the updated copy (so toast/feed uses corrected points)
      const savedRound = finalAll.find((r) => r.id === baseRound.id) || baseRound;

      // Awards (use savedRound)
      const computedAwards = computeAwardsForRound({
        round: savedRound,
        previousRoundsForPlayer: prevRoundsForPlayer,
      });

      const stamp = new Date().toISOString();

      const allBadges = getBadges({});
      const existingBadges = ensureArray(allBadges[playerId]);
      const nextBadges = computedAwards.badges.reduce((acc, a) => {
        return awardIfMissing(acc, { ...a, earnedAt: stamp, roundId: savedRound.id });
      }, existingBadges);
      setBadges({ ...allBadges, [playerId]: nextBadges });

      const trophiesMap = getTrophiesMap();
      const existingTrophies = ensureArray(trophiesMap[playerId]);
      const nextTrophies = computedAwards.trophies.reduce((acc, a) => {
        return awardIfMissing(acc, { ...a, earnedAt: stamp, roundId: savedRound.id });
      }, existingTrophies);
      setTrophiesMap({ ...trophiesMap, [playerId]: nextTrophies });

      // Feed post (uses final points)
      pushFeedPost({
        round: savedRound,
        pointsAdded: Number(savedRound.points) || 0,
        pointsBreakdown: savedRound.pointsBreakdown || null,
      });

      const rank = savedRound?.pointsBreakdown?.rank;
      const rankLabel =
        typeof rank === "number"
          ? rank === 1
            ? "1st"
            : rank === 2
            ? "2nd"
            : rank === 3
            ? "3rd"
            : `${rank}th`
          : null;

      setToast({
        type: "success",
        title: "Round submitted",
        msg: rankLabel
          ? `${rankLabel} place — +${savedRound.points} points added for ${getPlayerLabel(playerObj)}.`
          : `+${savedRound.points} points added for ${getPlayerLabel(playerObj)}.`,
      });

      // Reset
      setForm((f) => ({
        ...f,
        date: todayISO(),
        course: "",
        holes: 18,
        par: 72,
        grossScore: "",
        birdies: 0,
        eagles: 0,
        hio: 0,
        isMajor: false,
        notes: "",
        playerId: isHost ? f.playerId : currentUserId,
      }));
      setTouched({});
      setCardPhoto(null);

      setTimeout(() => {
        navigate("/leagues");
      }, 650);
    } finally {
      setSaving(false);
    }
  }

  const pointsPreviewRow = useMemo(() => {
    if (!usingNewPoints) {
      return (
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">Points Preview</div>
            <div className="text-xs text-slate-600">
              Legacy mode. Switch points in League → More → Points Settings.
            </div>
          </div>
          <div className="rounded-2xl bg-slate-900 px-3 py-1.5 text-sm font-bold text-white">
            {computed.points} pts
          </div>
        </div>
      );
    }

    const rank = computed.breakdown?.rank;
    const rankLabel =
      typeof rank === "number"
        ? rank === 1
          ? "1st"
          : rank === 2
          ? "2nd"
          : rank === 3
          ? "3rd"
          : `${rank}th`
        : "—";

    const placementPoints = computed.breakdown?.placementPoints ?? 0;
    const bonusPoints = computed.breakdown?.bonusPoints ?? 0;
    const participationPoints = computed.breakdown?.participationPoints ?? 0;

    return (
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">Points Preview</div>
          <div className="text-xs text-slate-600">
            Rank if submitted now: <span className="font-semibold text-slate-900">{rankLabel}</span>
            {" · "}Placement {placementPoints}
            {participationPoints ? ` · Play +${participationPoints}` : ""}
            {bonusPoints ? ` · Bonus +${bonusPoints}` : " · Bonuses off"}
          </div>
        </div>
        <div className="rounded-2xl bg-slate-900 px-3 py-1.5 text-sm font-bold text-white">
          {computed.points} pts
        </div>
      </div>
    );
  }, [computed, usingNewPoints]);

  if (!players.length) {
    return (
      <div className="pt-2">
        <PageHeader title="Submit Round" subtitle="Add a round to the league." />
        <div className="mt-4">
          <EmptyState
            icon="👥"
            title="No players found"
            description="Your league needs at least one player in localStorage to submit a round."
            action={
              <button
                onClick={() => navigate("/leagues")}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-extrabold text-white"
              >
                Back to League
              </button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Submit Round" subtitle="Fast entry. Clean stats. Auto points." />

      {toast ? (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm shadow-sm ${
            toast.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-rose-200 bg-rose-50 text-rose-900"
          }`}
          role="status"
        >
          <div className="font-semibold">{toast.title}</div>
          <div className="opacity-90">{toast.msg}</div>
        </div>
      ) : null}

      {/* Who you are */}
      <Card className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-extrabold text-slate-900">You are</div>
            <div className="mt-0.5 text-xs font-semibold text-slate-600">
              For MVP testing: pick who’s using this device right now.
            </div>
          </div>

          {isHost ? (
            <div className="rounded-xl bg-amber-100 px-3 py-2 text-xs font-extrabold text-amber-900 ring-1 ring-amber-200">
              Host
            </div>
          ) : (
            <div className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-extrabold text-slate-700 ring-1 ring-slate-200">
              Player
            </div>
          )}
        </div>

        <div className="mt-3">
          <select
            value={currentUserId}
            onChange={(e) => {
              const next = e.target.value;
              setCurrentUserId(next);
              try {
                localStorage.setItem(CURRENT_USER_KEY, next);
              } catch {
                // ignore
              }
            }}
            className={`w-full rounded-xl border bg-white px-3 py-3 text-sm outline-none ${
              touched.currentUserId && errors.currentUserId ? "border-rose-300" : "border-slate-200"
            }`}
          >
            {players.map((p) => {
              const id = p.id || p._id || "";
              return (
                <option key={id} value={id}>
                  {getPlayerLabel(p)}
                </option>
              );
            })}
          </select>

          {errors.currentUserId ? (
            <div className="mt-1 text-xs font-semibold text-rose-600">{errors.currentUserId}</div>
          ) : null}

          {currentUser ? (
            <div className="mt-2 text-xs font-semibold text-slate-600">
              Submitting as:{" "}
              <span className="font-extrabold text-slate-900">{getPlayerLabel(currentUser)}</span>
            </div>
          ) : null}
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-extrabold text-slate-900">Create a feed post?</div>
            <div className="mt-0.5 text-xs font-semibold text-slate-600">
              Makes the app feel social (recommended).
            </div>
          </div>

          <button
            type="button"
            onClick={() => setCreatePost((v) => !v)}
            className={`relative inline-flex h-8 w-14 items-center rounded-full border transition ${
              createPost ? "border-emerald-300 bg-emerald-100" : "border-slate-200 bg-white"
            }`}
            aria-pressed={createPost}
          >
            <span
              className={`inline-block h-6 w-6 transform rounded-full bg-slate-900 transition ${
                createPost ? "translate-x-7" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        {createPost ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Post to:</div>
            <Pill active={postToPublic} onClick={() => setPostToPublic((v) => !v)}>
              Public
            </Pill>
            <Pill active={postToFriends} onClick={() => setPostToFriends((v) => !v)}>
              Friends
            </Pill>
            <Pill active={postToLeague} onClick={() => setPostToLeague((v) => !v)}>
              League
            </Pill>

            {!postToPublic && !postToFriends && !postToLeague ? (
              <div className="w-full text-xs font-semibold text-rose-600">
                Pick at least one destination (Public / Friends / League).
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Card className="p-4">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Round Details</div>
                <div className="text-xs text-slate-600">Date, player, and basic scoring.</div>
              </div>
              <button
                type="button"
                onClick={() => navigate("/leagues")}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900 shadow-sm active:scale-[0.99]"
              >
                League
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Player</label>
                <select
                  value={form.playerId}
                  onChange={(e) => update("playerId", e.target.value)}
                  onBlur={() => markTouched("playerId")}
                  disabled={!isHost}
                  className={`w-full rounded-xl border bg-white px-3 py-3 text-sm outline-none ${
                    touched.playerId && errors.playerId ? "border-rose-300" : "border-slate-200"
                  } ${!isHost ? "bg-slate-50 text-slate-600" : ""}`}
                  title={!isHost ? "Players submit their own scores. Host can submit for others." : ""}
                >
                  {players.map((p) => {
                    const id = p.id || p._id || "";
                    return (
                      <option key={id} value={id}>
                        {getPlayerLabel(p)}
                      </option>
                    );
                  })}
                </select>

                {!isHost ? (
                  <div className="mt-1 text-xs font-semibold text-slate-500">
                    Players submit their own score. (Host can submit for others.)
                  </div>
                ) : null}

                {touched.playerId && errors.playerId ? (
                  <div className="mt-1 text-xs text-rose-600">{errors.playerId}</div>
                ) : null}
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Date</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => update("date", e.target.value)}
                  onBlur={() => markTouched("date")}
                  className={`w-full rounded-xl border bg-white px-3 py-3 text-sm outline-none ${
                    touched.date && errors.date ? "border-rose-300" : "border-slate-200"
                  }`}
                />
                {touched.date && errors.date ? (
                  <div className="mt-1 text-xs text-rose-600">{errors.date}</div>
                ) : null}
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Course</label>
                <input
                  type="text"
                  value={form.course}
                  onChange={(e) => update("course", e.target.value)}
                  onBlur={() => markTouched("course")}
                  placeholder="e.g. Royal Birkdale"
                  className={`w-full rounded-xl border bg-white px-3 py-3 text-sm outline-none ${
                    touched.course && errors.course ? "border-rose-300" : "border-slate-200"
                  }`}
                />
                {touched.course && errors.course ? (
                  <div className="mt-1 text-xs text-rose-600">{errors.course}</div>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Holes</label>
                <select
                  value={form.holes}
                  onChange={(e) => update("holes", Number(e.target.value))}
                  onBlur={() => markTouched("holes")}
                  className={`w-full rounded-xl border bg-white px-3 py-3 text-sm outline-none ${
                    touched.holes && errors.holes ? "border-rose-300" : "border-slate-200"
                  }`}
                >
                  <option value={18}>18</option>
                  <option value={9}>9</option>
                </select>
                {touched.holes && errors.holes ? (
                  <div className="mt-1 text-xs text-rose-600">{errors.holes}</div>
                ) : null}
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Par</label>
                <input
                  inputMode="numeric"
                  value={form.par}
                  onChange={(e) => update("par", clampInt(parseInt(e.target.value || "0", 10), 60, 78))}
                  onBlur={() => markTouched("par")}
                  className={`w-full rounded-xl border bg-white px-3 py-3 text-sm outline-none ${
                    touched.par && errors.par ? "border-rose-300" : "border-slate-200"
                  }`}
                />
                {touched.par && errors.par ? (
                  <div className="mt-1 text-xs text-rose-600">{errors.par}</div>
                ) : null}
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Score</label>
                <input
                  inputMode="numeric"
                  value={form.grossScore}
                  onChange={(e) => update("grossScore", e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                  onBlur={() => markTouched("grossScore")}
                  placeholder="e.g. 84"
                  className={`w-full rounded-xl border bg-white px-3 py-3 text-sm outline-none ${
                    touched.grossScore && errors.grossScore ? "border-rose-300" : "border-slate-200"
                  }`}
                />
                {touched.grossScore && errors.grossScore ? (
                  <div className="mt-1 text-xs text-rose-600">{errors.grossScore}</div>
                ) : null}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-slate-700">To Par</div>
                <div className="rounded-xl bg-white px-2.5 py-1 text-xs font-bold text-slate-900 shadow-sm">
                  {computed.netLabel}
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Scorecard photo */}
        <Card className="p-4">
          <div className="space-y-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">Scorecard photo (optional)</div>
              <div className="text-xs text-slate-600">
                Helps verify rounds. Saved as a small, compressed image (MVP-safe).
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-extrabold text-white hover:bg-slate-800">
                {compressing ? "Compressing…" : "Upload photo"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onPickScorecard}
                  disabled={compressing}
                />
              </label>

              {cardPhoto ? (
                <button
                  type="button"
                  onClick={() => setCardPhoto(null)}
                  className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-extrabold text-slate-900 hover:bg-slate-200"
                >
                  Remove
                </button>
              ) : null}
            </div>

            {cardPhoto ? (
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <img src={cardPhoto} alt="Scorecard" className="h-56 w-full object-cover" />
                <div className="border-t border-slate-200 px-4 py-3 text-xs font-semibold text-slate-600">
                  Stored with the round (not posted to feed by default).
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600">
                Tip: snap the card flat + good lighting. (Later: AI scan can auto-fill the form.)
              </div>
            )}
          </div>
        </Card>

        <Card className="p-4">
          <div className="space-y-4">
            <div>
              <div className="text-sm font-semibold text-slate-900">Scoring Events</div>
              <div className="text-xs text-slate-600">
                Always tracked for badges/trophies. Bonus points are league-controlled.
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Birdies</label>
                <input
                  inputMode="numeric"
                  value={form.birdies}
                  onChange={(e) => update("birdies", clampInt(parseInt(e.target.value || "0", 10), 0, 99))}
                  onBlur={() => markTouched("birdies")}
                  className={`w-full rounded-xl border bg-white px-3 py-3 text-sm outline-none ${
                    touched.birdies && errors.birdies ? "border-rose-300" : "border-slate-200"
                  }`}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Eagles</label>
                <input
                  inputMode="numeric"
                  value={form.eagles}
                  onChange={(e) => update("eagles", clampInt(parseInt(e.target.value || "0", 10), 0, 99))}
                  onBlur={() => markTouched("eagles")}
                  className={`w-full rounded-xl border bg-white px-3 py-3 text-sm outline-none ${
                    touched.eagles && errors.eagles ? "border-rose-300" : "border-slate-200"
                  }`}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">HIO</label>
                <input
                  inputMode="numeric"
                  value={form.hio}
                  onChange={(e) => update("hio", clampInt(parseInt(e.target.value || "0", 10), 0, 18))}
                  onBlur={() => markTouched("hio")}
                  className={`w-full rounded-xl border bg-white px-3 py-3 text-sm outline-none ${
                    touched.hio && errors.hio ? "border-rose-300" : "border-slate-200"
                  }`}
                />
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              {pointsPreviewRow}
            </div>

            {usingNewPoints ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-700">
                League points are active (custom placement table + optional bonuses).
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-700">
                Legacy scoring is active. Set league points in League → More → Points Settings.
              </div>
            )}
          </div>
        </Card>

        <Card className="p-4">
          <div className="space-y-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">Notes</div>
              <div className="text-xs text-slate-600">
                Optional. If you create a feed post, this becomes the caption.
              </div>
            </div>

            <textarea
              value={form.notes}
              onChange={(e) => update("notes", e.target.value)}
              placeholder="Quick highlight… conditions, best holes, matchplay drama…"
              rows={4}
              className="w-full resize-none rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none"
            />
          </div>
        </Card>

        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/90 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-xl items-center gap-3">
            <button
              type="button"
              onClick={() => navigate("/leagues")}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 shadow-sm active:scale-[0.99]"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={!canSubmit}
              className={`w-full rounded-2xl px-4 py-3 text-sm font-semibold text-white shadow-sm active:scale-[0.99] ${
                canSubmit ? "bg-slate-900" : "bg-slate-400"
              }`}
            >
              {saving ? "Saving…" : compressing ? "Processing…" : `Submit (+${computed.points})`}
            </button>
          </div>
        </div>
      </form>

      <div className="h-24" />
    </div>
  );
}






