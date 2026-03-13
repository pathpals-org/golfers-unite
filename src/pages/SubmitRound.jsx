// src/pages/SubmitRound.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import Card from "../components/ui/Card";
import PageHeader from "../components/ui/PageHeader";
import EmptyState from "../components/ui/EmptyState";
import { supabase } from "../lib/supabaseClient";

import {
  KEYS,
  set,
  getLeague,
  getRounds,
  getPointsSystem,
  calculateLeaguePoints,
  DEFAULT_POINTS_SYSTEM,
  getActiveLeagueIdSupabaseFirst,
  syncActiveLeagueFromSupabase,
} from "../utils/storage";

function safeUUID(prefix = "id") {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // ignore
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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

function cleanLeagueId(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.toLowerCase() === "undefined" || s.toLowerCase() === "null") return null;
  return s;
}

function getPlayerLabel(p) {
  if (!p) return "Unknown";
  return p.display_name || p.username || p.name || p.fullName || p.displayName || "Unnamed Player";
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

function makeEventKey({ leagueId, date, course, holes }) {
  return [
    leagueId || "no_league",
    date || "no_date",
    (course || "").trim().toLowerCase(),
    String(holes || 18),
  ].join("::");
}

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

function humanErr(e) {
  return e?.message || String(e || "Something went wrong.");
}

async function resolveCurrentLeagueForUser(authUserId) {
  const cachedLeague = getLeague(null);
  const cachedId = cleanLeagueId(cachedLeague?.id);

  if (cachedId) {
    return cachedId;
  }

  try {
    const activeLeagueId = await getActiveLeagueIdSupabaseFirst();
    const cleanActive = cleanLeagueId(activeLeagueId);
    if (cleanActive) return cleanActive;
  } catch {
    // ignore
  }

  const membershipRes = await supabase
    .from("league_members")
    .select("league_id, role, status, joined_at")
    .eq("user_id", authUserId)
    .eq("status", "active")
    .order("joined_at", { ascending: false })
    .limit(1);

  if (membershipRes.error) throw membershipRes.error;

  return cleanLeagueId(membershipRes.data?.[0]?.league_id || null);
}

async function insertRoundRobust({
  leagueId,
  playerId,
  submittedBy,
  date,
  course,
  holes,
  par,
  grossScore,
  birdies,
  eagles,
  hio,
  isMajor,
  notes,
}) {
  const attempts = [
    {
      league_id: leagueId,
      user_id: playerId,
      submitted_by: submittedBy,
      date,
      course,
      holes,
      par,
      gross_score: grossScore,
      birdies,
      eagles,
      hio,
      is_major: isMajor,
      notes,
      status: "approved",
    },
    {
      league_id: leagueId,
      player_id: playerId,
      submitted_by: submittedBy,
      date,
      course,
      holes,
      par,
      gross_score: grossScore,
      birdies,
      eagles,
      hio,
      is_major: isMajor,
      notes,
      status: "approved",
    },
    {
      league_id: leagueId,
      user_id: playerId,
      date,
      course,
      holes,
      par,
      gross_score: grossScore,
      birdies,
      eagles,
      hio,
      is_major: isMajor,
      notes,
      status: "approved",
    },
    {
      league_id: leagueId,
      player_id: playerId,
      date,
      course,
      holes,
      par,
      gross_score: grossScore,
      birdies,
      eagles,
      hio,
      is_major: isMajor,
      notes,
      status: "approved",
    },
    {
      league_id: leagueId,
      user_id: playerId,
      date,
      course,
      gross_score: grossScore,
    },
    {
      league_id: leagueId,
      player_id: playerId,
      date,
      course,
      gross_score: grossScore,
    },
  ];

  let lastError = null;

  for (const payload of attempts) {
    // eslint-disable-next-line no-await-in-loop
    const res = await supabase.from("rounds").insert(payload).select("*").maybeSingle();

    if (!res.error) return res.data || null;

    lastError = res.error;
    const msg = String(res.error?.message || "").toLowerCase();

    if (msg.includes("column") && msg.includes("does not exist")) continue;
    if (msg.includes("null value") && msg.includes("violates")) continue;
    if (msg.includes("schema cache")) continue;
    break;
  }

  throw lastError || new Error("Failed to save round to Supabase.");
}

export default function SubmitRound() {
  const navigate = useNavigate();

  const [league, setLeagueState] = useState(() => getLeague(null));
  const [players, setPlayers] = useState([]);
  const [authUserId, setAuthUserId] = useState("");
  const [myRole, setMyRole] = useState("");
  const [leagueLoading, setLeagueLoading] = useState(true);
  const [leagueError, setLeagueError] = useState("");

  const [legacyPointsSystem, setLegacyPointsSystem] = useState(null);

  const [toast, setToast] = useState(null);
  const [touched, setTouched] = useState({});
  const [saving, setSaving] = useState(false);

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
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    let alive = true;

    async function loadSubmitContext() {
      setLeagueLoading(true);
      setLeagueError("");

      try {
        const sessionRes = await supabase.auth.getSession();
        const uid = sessionRes?.data?.session?.user?.id || "";
        if (!alive) return;

        if (!uid) {
          setLeagueError("You’re not logged in.");
          setPlayers([]);
          setLeagueState(null);
          setAuthUserId("");
          return;
        }

        setAuthUserId(uid);

        const fallbackPoints = getPointsSystem(null);
        setLegacyPointsSystem(fallbackPoints);

        const leagueId = await resolveCurrentLeagueForUser(uid);
        if (!alive) return;

        if (!leagueId) {
          setLeagueState(null);
          setPlayers([]);
          setLeagueError("You’re not currently in a league.");
          return;
        }

        const leagueRes = await supabase
          .from("leagues")
          .select("id,name,description,season_label,points_rules,host_user_id,created_by")
          .eq("id", leagueId)
          .maybeSingle();

        if (leagueRes.error) throw leagueRes.error;

        const leagueRow = leagueRes.data || null;
        if (!leagueRow?.id) {
          setLeagueState(null);
          setPlayers([]);
          setLeagueError("Couldn’t load your league.");
          return;
        }

        const memberRes = await supabase
          .from("league_members")
          .select("league_id,user_id,role,status,joined_at")
          .eq("league_id", leagueId)
          .eq("status", "active");

        if (memberRes.error) throw memberRes.error;

        const memberRows = ensureArray(memberRes.data);
        const userIds = memberRows.map((m) => m.user_id).filter(Boolean);

        let profileMap = {};
        if (userIds.length) {
          const profileRes = await supabase
            .from("profiles")
            .select("id,username,display_name")
            .in("id", userIds);

          if (!profileRes.error) {
            ensureArray(profileRes.data).forEach((p) => {
              if (!p?.id) return;
              profileMap[p.id] = p;
            });
          }
        }

        const nextPlayers = memberRows.map((m) => {
          const p = profileMap[m.user_id] || {};
          return {
            id: m.user_id,
            user_id: m.user_id,
            role: m.role,
            status: m.status,
            username: p.username || "",
            display_name: p.display_name || "",
            name: p.display_name || p.username || `User ${String(m.user_id).slice(0, 8)}…`,
          };
        });

        const meMembership = memberRows.find((m) => m.user_id === uid) || null;
        const nextRole = meMembership?.role || "";

        const nextLeague = {
          ...leagueRow,
          id: leagueRow.id,
          name: leagueRow.name || "League",
          hostId: leagueRow.host_user_id || leagueRow.created_by || "",
          pointsSystem:
            leagueRow.points_rules && typeof leagueRow.points_rules === "object"
              ? leagueRow.points_rules
              : null,
        };

        if (!alive) return;

        setLeagueState(nextLeague);
        setPlayers(nextPlayers);
        setMyRole(nextRole);

        setForm((f) => ({
          ...f,
          playerId:
            nextRole === "host" || nextRole === "co_host"
              ? f.playerId || uid
              : uid,
        }));
      } catch (e) {
        if (!alive) return;
        setLeagueError(humanErr(e));
        setPlayers([]);
        setLeagueState(null);
      } finally {
        if (!alive) return;
        setLeagueLoading(false);
      }
    }

    loadSubmitContext();

    return () => {
      alive = false;
    };
  }, []);

  const currentUser = useMemo(() => {
    if (!authUserId) return null;
    return players.find((p) => p.id === authUserId || p.user_id === authUserId) || null;
  }, [players, authUserId]);

  const selectedPlayer = useMemo(() => {
    const id = form.playerId;
    return players.find((p) => p.id === id || p.user_id === id) || null;
  }, [players, form.playerId]);

  const isHost = myRole === "host" || myRole === "co_host";

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

    const legacy = legacyPointsSystem && typeof legacyPointsSystem === "object" ? legacyPointsSystem : null;

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
      breakdown: {
        mode: "legacy",
        baseRound,
        extras: preMult - baseRound,
        multiplier: form.isMajor ? majorMultiplier : 1,
      },
      diff,
      netLabel: diff === null ? "—" : diff === 0 ? "E" : diff > 0 ? `+${diff}` : `${diff}`,
    };
  }, [form, league?.id, leaguePointsSystem, usingNewPoints, legacyPointsSystem]);

  const errors = useMemo(() => {
    const e = {};

    if (!authUserId) e.authUserId = "You must be logged in.";
    if (!league?.id) e.league = "No active league found.";
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
  }, [form, authUserId, league?.id]);

  const canSubmit = Object.keys(errors).length === 0 && !saving && !compressing && !leagueLoading;

  function update(name, value) {
    setForm((f) => ({ ...f, [name]: value }));
  }

  function markTouched(name) {
    setTouched((t) => ({ ...t, [name]: true }));
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
      setToast({ type: "success", title: "Scorecard added", msg: "Saved with this round preview." });
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
      authUserId: true,
      league: true,
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
      const leagueId = cleanLeagueId(league?.id);
      if (!leagueId) throw new Error("No active league found.");

      const playerId = isHost ? form.playerId : authUserId;

      const playerObj = players.find((p) => p.id === playerId || p.user_id === playerId);
      const playerName = getPlayerLabel(playerObj);

      const grossScore = Number(form.grossScore);
      const birdies = clampInt(Number(form.birdies), 0, 99);
      const eagles = clampInt(Number(form.eagles), 0, 99);
      const hio = clampInt(Number(form.hio), 0, 18);

      // 1) Save to Supabase first
      let insertedRound = null;
      try {
        insertedRound = await insertRoundRobust({
          leagueId,
          playerId,
          submittedBy: authUserId,
          date: form.date,
          course: form.course.trim(),
          holes: Number(form.holes),
          par: Number(form.par),
          grossScore,
          birdies,
          eagles,
          hio,
          isMajor: Boolean(form.isMajor),
          notes: form.notes.trim(),
        });
      } catch (dbErr) {
        throw new Error(`Round save failed in Supabase: ${humanErr(dbErr)}`);
      }

      // 2) Also update local cache immediately for fast UI/preview
      const allRoundsBefore = ensureArray(getRounds([]));

      const baseRound = {
        id: insertedRound?.id || safeUUID("round"),
        createdAt: insertedRound?.created_at || new Date().toISOString(),
        date: form.date,
        playerId,
        userId: playerId,
        submittedBy: authUserId,
        playerName,
        course: form.course.trim(),
        holes: Number(form.holes),
        par: Number(form.par),
        grossScore,
        birdies,
        eagles,
        hio,
        isMajor: Boolean(form.isMajor),
        notes: form.notes.trim(),
        leagueId,
        cardPhoto: cardPhoto || null,
        status: "approved",
        points: Number(computed.points) || 0,
        pointsBreakdown: computed.breakdown || null,
      };

      const allAfterAdd = [baseRound, ...allRoundsBefore];

      let finalAll = allAfterAdd;
      if (usingNewPoints) {
        finalAll = recomputeEventPoints(allAfterAdd, {
          leagueId,
          date: baseRound.date,
          course: baseRound.course,
          holes: baseRound.holes,
          pointsSystem: leaguePointsSystem || DEFAULT_POINTS_SYSTEM,
        });
      }

      set(KEYS.rounds, finalAll);

      // 3) Re-sync league cache from Supabase if available
      try {
        await syncActiveLeagueFromSupabase({ leagueId, withRounds: true });
      } catch {
        // fail-soft
      }

      const savedRound = finalAll.find((r) => r.id === baseRound.id) || baseRound;

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
        title: "Round posted",
        msg: rankLabel
          ? `${playerName} posted a round in ${league?.name || "your league"} — ${rankLabel}, +${savedRound.points} pts.`
          : `${playerName} posted a round in ${league?.name || "your league"} — +${savedRound.points} pts.`,
      });

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
        playerId: isHost ? f.playerId : authUserId,
      }));
      setTouched({});
      setCardPhoto(null);

      setTimeout(() => {
        navigate("/leagues");
      }, 700);
    } catch (err) {
      setToast({
        type: "error",
        title: "Couldn’t post round",
        msg: humanErr(err),
      });
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
            <div className="text-xs text-slate-600">Legacy mode.</div>
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
            Rank if posted now: <span className="font-semibold text-slate-900">{rankLabel}</span>
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

  if (leagueLoading) {
    return (
      <div className="pt-2">
        <PageHeader title="Submit Round" subtitle="Loading your league…" />
        <div className="mt-4">
          <Card className="p-5">
            <div className="text-sm font-extrabold text-slate-900">Loading…</div>
            <div className="mt-2 text-sm font-semibold text-slate-600">
              Checking which league you’re in and loading members.
            </div>
          </Card>
        </div>
      </div>
    );
  }

  if (leagueError || !league?.id) {
    return (
      <div className="pt-2">
        <PageHeader title="Submit Round" subtitle="Post a round into your league." />
        <div className="mt-4">
          <EmptyState
            icon="🏌️"
            title="No active league found"
            description={leagueError || "You need to be in a league before posting a round."}
            action={
              <button
                onClick={() => navigate("/leagues")}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-extrabold text-white"
              >
                Back to Leagues
              </button>
            }
          />
        </div>
      </div>
    );
  }

  if (!players.length) {
    return (
      <div className="pt-2">
        <PageHeader title="Submit Round" subtitle="Post a round into your league." />
        <div className="mt-4">
          <EmptyState
            icon="👥"
            title="No league members found"
            description="Your league loaded, but no active members were found to submit a round for."
            action={
              <button
                onClick={() => navigate("/leagues")}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-extrabold text-white"
              >
                Back to Leagues
              </button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Submit Round" subtitle="Post a round directly into your current league." />

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

      <Card className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-extrabold text-slate-900">Posting into</div>
            <div className="mt-1 text-lg font-extrabold text-slate-900">{league.name || "League"}</div>
            <div className="mt-1 text-xs font-semibold text-slate-600">
              Only rounds for this league will be posted from this page.
            </div>
          </div>

          <span className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-extrabold text-slate-700 ring-1 ring-slate-200">
            {isHost ? "Host / Co-host" : "Player"}
          </span>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-extrabold text-slate-900">Submitting as</div>
            <div className="mt-0.5 text-xs font-semibold text-slate-600">
              Players submit their own rounds. Host/co-host can submit for any active member.
            </div>
          </div>

          <div className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-extrabold text-slate-700 ring-1 ring-slate-200">
            {getPlayerLabel(currentUser)}
          </div>
        </div>

        <div className="mt-3">
          <label className="mb-1 block text-xs font-semibold text-slate-700">Player</label>
          <select
            value={form.playerId}
            onChange={(e) => update("playerId", e.target.value)}
            onBlur={() => markTouched("playerId")}
            disabled={!isHost}
            className={`w-full rounded-xl border bg-white px-3 py-3 text-sm outline-none ${
              touched.playerId && errors.playerId ? "border-rose-300" : "border-slate-200"
            } ${!isHost ? "bg-slate-50 text-slate-600" : ""}`}
            title={!isHost ? "Players submit their own scores. Host/co-host can submit for others." : ""}
          >
            {players.map((p) => {
              const id = p.id || p.user_id || "";
              return (
                <option key={id} value={id}>
                  {getPlayerLabel(p)}
                </option>
              );
            })}
          </select>

          {!isHost ? (
            <div className="mt-1 text-xs font-semibold text-slate-500">
              You can only post your own score from this account.
            </div>
          ) : null}

          {touched.playerId && errors.playerId ? (
            <div className="mt-1 text-xs text-rose-600">{errors.playerId}</div>
          ) : null}
        </div>
      </Card>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Card className="p-4">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Round Details</div>
                <div className="text-xs text-slate-600">Date, course, score, and round type.</div>
              </div>

              <button
                type="button"
                onClick={() => navigate("/leagues")}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900 shadow-sm active:scale-[0.99]"
              >
                Back
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3">
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

            <div className="flex flex-wrap items-center gap-2">
              <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Round type:</div>
              <Pill active={!form.isMajor} onClick={() => update("isMajor", false)}>
                Standard
              </Pill>
              <Pill active={form.isMajor} onClick={() => update("isMajor", true)}>
                Major
              </Pill>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="space-y-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">Scorecard photo (optional)</div>
              <div className="text-xs text-slate-600">
                Helpful for proof. Saved with the round preview.
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-extrabold text-white hover:bg-slate-800">
                {compressing ? "Processing…" : "Upload photo"}
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
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600">
                Tip: later you can wire AI scorecard scanning into this image flow.
              </div>
            )}
          </div>
        </Card>

        <Card className="p-4">
          <div className="space-y-4">
            <div>
              <div className="text-sm font-semibold text-slate-900">Scoring Events</div>
              <div className="text-xs text-slate-600">
                These feed badges/trophies later and can affect bonus points now.
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
                This league is using its live Supabase points rules.
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-700">
                Using fallback local points settings.
              </div>
            )}
          </div>
        </Card>

        <Card className="p-4">
          <div className="space-y-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">Notes</div>
              <div className="text-xs text-slate-600">
                Optional notes about the round.
              </div>
            </div>

            <textarea
              value={form.notes}
              onChange={(e) => update("notes", e.target.value)}
              placeholder="Quick highlight… weather, best hole, drama…"
              rows={4}
              className="w-full resize-none rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none"
            />
          </div>
        </Card>

        {/* ✅ Clear sticky submit area, above mobile bottom tabs */}
        <div className="sticky bottom-24 z-20">
          <Card className="p-3 shadow-lg ring-1 ring-slate-200">
            <div className="flex items-center gap-3">
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
                className={`w-full rounded-2xl px-4 py-3 text-sm font-extrabold text-white shadow-sm active:scale-[0.99] ${
                  canSubmit ? "bg-emerald-600 hover:bg-emerald-500" : "bg-slate-400"
                }`}
              >
                {saving ? "Posting…" : compressing ? "Processing…" : `Post Round (+${computed.points})`}
              </button>
            </div>
          </Card>
        </div>
      </form>

      <div className="h-10" />
    </div>
  );
}






