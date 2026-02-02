// src/pages/Profile.jsx
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import PageHeader from "../components/ui/PageHeader";
import Card from "../components/ui/Card";
import EmptyState from "../components/ui/EmptyState";

import { getUsers, getRounds, getBadges, getTrophiesMap } from "../utils/storage";

function ensureArr(v) {
  return Array.isArray(v) ? v : [];
}

function getUserId(u) {
  return u?.id || u?._id || null;
}

function getUserName(u) {
  return u?.name || u?.fullName || u?.displayName || u?.username || "Golfer";
}

function sum(nums) {
  return nums.reduce((a, b) => a + (Number(b) || 0), 0);
}

function formatDateShort(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function Stat({ label, value }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
      <div className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-lg font-extrabold text-slate-900">{value}</div>
    </div>
  );
}

/**
 * Color system for awards (MVP-safe, based on award key/title)
 */
function getAwardTone(award) {
  const key = String(award?.key || "").toLowerCase();
  const title = String(award?.title || "").toLowerCase();

  // Birdie / pointsy badges
  if (key.includes("birdie") || title.includes("birdie")) {
    return {
      bg: "bg-emerald-50",
      ring: "ring-emerald-200",
      iconBg: "bg-emerald-600",
      iconText: "text-white",
      text: "text-emerald-900",
      sub: "text-emerald-700",
      tagBg: "bg-emerald-100",
      tagText: "text-emerald-800",
      tagRing: "ring-emerald-200",
      tag: "Birdie",
    };
  }

  // Eagle trophy
  if (key.includes("eagle") || title.includes("eagle")) {
    return {
      bg: "bg-amber-50",
      ring: "ring-amber-200",
      iconBg: "bg-amber-600",
      iconText: "text-white",
      text: "text-amber-950",
      sub: "text-amber-800",
      tagBg: "bg-amber-100",
      tagText: "text-amber-900",
      tagRing: "ring-amber-200",
      tag: "Eagle",
    };
  }

  // Hole in one
  if (key.includes("hole_in_one") || key.includes("hio") || title.includes("hole in one")) {
    return {
      bg: "bg-violet-50",
      ring: "ring-violet-200",
      iconBg: "bg-violet-600",
      iconText: "text-white",
      text: "text-violet-950",
      sub: "text-violet-800",
      tagBg: "bg-violet-100",
      tagText: "text-violet-800",
      tagRing: "ring-violet-200",
      tag: "Ace",
    };
  }

  // Majors
  if (key.includes("major") || title.includes("major")) {
    return {
      bg: "bg-sky-50",
      ring: "ring-sky-200",
      iconBg: "bg-sky-600",
      iconText: "text-white",
      text: "text-sky-950",
      sub: "text-sky-800",
      tagBg: "bg-sky-100",
      tagText: "text-sky-800",
      tagRing: "ring-sky-200",
      tag: "Major",
    };
  }

  // Break 80 / elite
  if (key.includes("break_80") || title.includes("break 80")) {
    return {
      bg: "bg-fuchsia-50",
      ring: "ring-fuchsia-200",
      iconBg: "bg-fuchsia-600",
      iconText: "text-white",
      text: "text-fuchsia-950",
      sub: "text-fuchsia-800",
      tagBg: "bg-fuchsia-100",
      tagText: "text-fuchsia-800",
      tagRing: "ring-fuchsia-200",
      tag: "Elite",
    };
  }

  // Default
  return {
    bg: "bg-slate-50",
    ring: "ring-slate-200",
    iconBg: "bg-slate-900",
    iconText: "text-white",
    text: "text-slate-900",
    sub: "text-slate-600",
    tagBg: "bg-slate-100",
    tagText: "text-slate-700",
    tagRing: "ring-slate-200",
    tag: "Award",
  };
}

/**
 * New: Achievement tile (replaces the plain AwardChip list feel)
 */
function AchievementTile({ award, kind = "award" }) {
  const tone = getAwardTone(award);
  const icon = award?.icon || (kind === "trophy" ? "🏆" : "🏅");

  return (
    <div
      className={[
        "relative overflow-hidden rounded-2xl p-4 ring-1 shadow-sm",
        tone.bg,
        tone.ring,
      ].join(" ")}
    >
      {/* subtle highlight */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/60 to-transparent" />

      <div className="flex items-start gap-3">
        <div
          className={[
            "grid h-11 w-11 place-items-center rounded-2xl shadow-sm ring-1 ring-white/40",
            tone.iconBg,
            tone.iconText,
          ].join(" ")}
        >
          <span className="text-xl">{icon}</span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className={["text-sm font-extrabold", tone.text].join(" ")}>
              {award?.title || (kind === "trophy" ? "Trophy" : "Badge")}
            </div>

            <span
              className={[
                "rounded-full px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide ring-1",
                tone.tagBg,
                tone.tagText,
                tone.tagRing,
              ].join(" ")}
            >
              {kind === "trophy" ? "Trophy" : "Badge"} · {tone.tag}
            </span>
          </div>

          {award?.desc ? (
            <div className={["mt-1 text-xs font-semibold", tone.sub].join(" ")}>
              {award.desc}
            </div>
          ) : null}

          {award?.earnedAt ? (
            <div className="mt-2 text-[11px] font-semibold text-slate-500">
              Earned {formatDateShort(award.earnedAt)}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function Profile() {
  const navigate = useNavigate();
  const location = useLocation();

  const [users, setUsers] = useState(() => ensureArr(getUsers([])));
  const [rounds, setRounds] = useState(() => ensureArr(getRounds([])));
  const [badgesMap, setBadgesMap] = useState(() => getBadges({}));
  const [trophiesMap, setTrophiesMapState] = useState(() => getTrophiesMap());

  // MVP assumption: current user = first user
  const me = users?.[0] || null;
  const myId = getUserId(me);

  function resync() {
    setUsers(ensureArr(getUsers([])));
    setRounds(ensureArr(getRounds([])));
    setBadgesMap(getBadges({}));
    setTrophiesMapState(getTrophiesMap());
  }

  useEffect(() => {
    resync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  useEffect(() => {
    const onFocus = () => resync();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const myRounds = useMemo(() => {
    if (!myId) return [];
    return rounds.filter((r) => r?.playerId === myId);
  }, [rounds, myId]);

  const myBadges = useMemo(() => {
    if (!myId) return [];
    const list = badgesMap?.[myId];
    return Array.isArray(list) ? list : [];
  }, [badgesMap, myId]);

  const myTrophies = useMemo(() => {
    if (!myId) return [];
    const list = trophiesMap?.[myId];
    return Array.isArray(list) ? list : [];
  }, [trophiesMap, myId]);

  // Sort awards newest-first (helps cabinet feel real)
  const myTrophiesSorted = useMemo(() => {
    return [...myTrophies].sort((a, b) => {
      const ta = new Date(a?.earnedAt || 0).getTime();
      const tb = new Date(b?.earnedAt || 0).getTime();
      return tb - ta;
    });
  }, [myTrophies]);

  const myBadgesSorted = useMemo(() => {
    return [...myBadges].sort((a, b) => {
      const ta = new Date(a?.earnedAt || 0).getTime();
      const tb = new Date(b?.earnedAt || 0).getTime();
      return tb - ta;
    });
  }, [myBadges]);

  const stats = useMemo(() => {
    const grossScores = myRounds
      .map((r) => Number(r?.grossScore))
      .filter((n) => Number.isFinite(n));

    const points = myRounds
      .map((r) => Number(r?.points))
      .filter((n) => Number.isFinite(n));

    const birdies = sum(myRounds.map((r) => r?.birdies));
    const eagles = sum(myRounds.map((r) => r?.eagles));
    const hio = sum(myRounds.map((r) => r?.hio));
    const majors = myRounds.filter((r) => !!r?.isMajor).length;

    const best = grossScores.length ? Math.min(...grossScores) : null;
    const totalPoints = points.length ? sum(points) : 0;

    const lastRound = myRounds[0] || null; // newest-first (addRound prepends)
    return {
      rounds: myRounds.length,
      totalPoints,
      birdies,
      eagles,
      hio,
      majors,
      best,
      lastRound,
    };
  }, [myRounds]);

  const handicap =
    me?.handicap ??
    me?.hcp ??
    me?.index ??
    me?.handicapIndex ??
    null;

  if (!me) {
    return (
      <div className="space-y-4">
        <PageHeader title="Profile" subtitle="Set up a golfer to see your stats." />
        <EmptyState
          icon="🙂"
          title="No golfer found"
          description="Your seed/users list is empty. Add a user in localStorage or seed data."
          actions={
            <button
              onClick={() => navigate("/leagues")}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-extrabold text-white"
            >
              Go to League
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profile"
        subtitle="Career cabinet, stats, and play history."
        right={
          <button
            type="button"
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-extrabold text-white hover:bg-slate-800"
          >
            Edit Profile
          </button>
        }
      />

      {/* Profile card */}
      <Card className="p-5">
        <div className="flex items-center gap-4">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-slate-50 text-2xl ring-1 ring-slate-200">
            🙂
          </div>

          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-extrabold text-slate-900">
              {getUserName(me)}
            </div>
            <div className="mt-0.5 text-xs font-semibold text-slate-600">
              Handicap:{" "}
              <span className="font-extrabold text-slate-900">
                {handicap === null || handicap === undefined || handicap === ""
                  ? "—"
                  : handicap}
              </span>
            </div>
          </div>

          <div className="rounded-2xl bg-slate-50 px-3 py-2 text-xs font-extrabold text-slate-700 ring-1 ring-slate-200">
            {stats.rounds} rounds
          </div>
        </div>

        {stats.lastRound ? (
          <div className="mt-4 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
            <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
              Last round
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <div className="text-lg font-extrabold text-slate-900">
                {stats.lastRound.grossScore ?? "--"}
              </div>
              <div className="text-sm font-extrabold text-emerald-700">
                +{stats.lastRound.points ?? 0} pts
              </div>
              <div className="text-sm font-extrabold text-slate-700">
                {stats.lastRound.course || "Course"}
              </div>
              <div className="text-xs font-semibold text-slate-500">
                {stats.lastRound.date || ""}
              </div>
            </div>
          </div>
        ) : null}
      </Card>

      {/* Career stats */}
      {stats.rounds === 0 ? (
        <EmptyState
          icon="📊"
          title="No rounds yet"
          description="Submit your first round and your stats will appear here."
          actions={
            <button
              onClick={() => navigate("/post")}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-emerald-500"
            >
              Submit a round
            </button>
          }
        />
      ) : (
        <Card className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-extrabold text-slate-900">Career stats</div>
              <div className="mt-0.5 text-xs font-semibold text-slate-600">
                Quick snapshot from your submitted rounds.
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Total points" value={stats.totalPoints} />
            <Stat label="Best score" value={stats.best ?? "—"} />
            <Stat label="Majors" value={stats.majors} />
            <Stat label="Birdies" value={stats.birdies} />
            <Stat label="Eagles" value={stats.eagles} />
            <Stat label="HIO" value={stats.hio} />
          </div>
        </Card>
      )}

      {/* Awards */}
      <Card className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-extrabold text-slate-900">
              Trophy cabinet & badge wall
            </div>
            <div className="mt-0.5 text-xs font-semibold text-slate-600">
              Earned from submitted rounds.
            </div>
          </div>

          <div className="rounded-2xl bg-slate-50 px-3 py-2 text-xs font-extrabold text-slate-700 ring-1 ring-slate-200">
            🏆 {myTrophies.length} · 🏅 {myBadges.length}
          </div>
        </div>

        {myTrophies.length === 0 && myBadges.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              icon="🏅"
              title="No awards yet"
              description="Submit rounds and you’ll start unlocking badges and trophies."
              actions={
                <button
                  onClick={() => navigate("/post")}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-emerald-500"
                >
                  Submit a round
                </button>
              }
            />
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            {/* TROPHIES */}
            {myTrophiesSorted.length ? (
              <div>
                <div className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">
                  Trophies
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {myTrophiesSorted.map((t) => (
                    <AchievementTile
                      key={t.key || t.id || `${t.title}-${t.earnedAt}`}
                      award={t}
                      kind="trophy"
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {/* BADGES */}
            {myBadgesSorted.length ? (
              <div>
                <div className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">
                  Badges
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {myBadgesSorted.map((b) => (
                    <AchievementTile
                      key={b.key || b.id || `${b.title}-${b.earnedAt}`}
                      award={b}
                      kind="badge"
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </Card>
    </div>
  );
}


