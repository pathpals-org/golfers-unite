// src/pages/Profile.jsx
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import PageHeader from "../components/ui/PageHeader";
import Card from "../components/ui/Card";
import EmptyState from "../components/ui/EmptyState";

import { useAuth } from "../auth/useAuth";
import { supabase } from "../lib/supabaseClient";
import { getRounds, getBadges, getTrophiesMap } from "../utils/storage";

function ensureArr(v) {
  return Array.isArray(v) ? v : [];
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

function humanErr(e) {
  return e?.message || String(e || "Something went wrong.");
}

function safeNum(v, fallback = null) {
  if (v === null || v === undefined) return fallback;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : fallback;
}

function emailPrefix(email) {
  return email ? String(email).split("@")[0] : "";
}

function displayNameFrom(p, email) {
  // Supabase-first, never show "Golfer" if we can help it
  return (
    p?.display_name ||
    p?.username ||
    emailPrefix(email) ||
    "Golfer"
  );
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

function getAwardTone(award) {
  const key = String(award?.key || "").toLowerCase();
  const title = String(award?.title || "").toLowerCase();

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

function AchievementTile({ award, kind = "award" }) {
  const tone = getAwardTone(award);
  const icon = award?.icon || (kind === "trophy" ? "🏆" : "🏅");

  return (
    <div className={["relative overflow-hidden rounded-2xl p-4 ring-1 shadow-sm", tone.bg, tone.ring].join(" ")}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/60 to-transparent" />
      <div className="flex items-start gap-3">
        <div className={["grid h-11 w-11 place-items-center rounded-2xl shadow-sm ring-1 ring-white/40", tone.iconBg, tone.iconText].join(" ")}>
          <span className="text-xl">{icon}</span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className={["text-sm font-extrabold", tone.text].join(" ")}>
              {award?.title || (kind === "trophy" ? "Trophy" : "Badge")}
            </div>

            <span className={["rounded-full px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide ring-1", tone.tagBg, tone.tagText, tone.tagRing].join(" ")}>
              {kind === "trophy" ? "Trophy" : "Badge"} · {tone.tag}
            </span>
          </div>

          {award?.desc ? <div className={["mt-1 text-xs font-semibold", tone.sub].join(" ")}>{award.desc}</div> : null}

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

  const { user, profile, loading, refreshProfile } = useAuth();

  const [rounds, setRounds] = useState(() => ensureArr(getRounds([])));
  const [badgesMap, setBadgesMap] = useState(() => getBadges({}));
  const [trophiesMap, setTrophiesMapState] = useState(() => getTrophiesMap());

  // ✅ Supabase-first profile state (fixes “falls back to email”)
  const [liveProfile, setLiveProfile] = useState(profile || null);
  const [profileLoading, setProfileLoading] = useState(false);

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftHandicap, setDraftHandicap] = useState("");
  const [saveLoading, setSaveLoading] = useState(false);
  const [status, setStatus] = useState({ type: "", message: "" });

  function resyncLocal() {
    setRounds(ensureArr(getRounds([])));
    setBadgesMap(getBadges({}));
    setTrophiesMapState(getTrophiesMap());
  }

  useEffect(() => {
    resyncLocal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  const myId = user?.id || null;

  // keep liveProfile in sync when auth context profile changes
  useEffect(() => {
    if (profile) setLiveProfile(profile);
  }, [profile]);

  async function fetchLiveProfile() {
    if (!myId) return;
    setProfileLoading(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, username, display_name, handicap_index")
        .eq("id", myId)
        .maybeSingle();

      if (!error && data) setLiveProfile(data);
    } finally {
      setProfileLoading(false);
    }
  }

  // Supabase-first fetch on entry / user change
  useEffect(() => {
    fetchLiveProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId]);

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

  const myTrophiesSorted = useMemo(() => {
    return [...myTrophies].sort((a, b) => new Date(b?.earnedAt || 0).getTime() - new Date(a?.earnedAt || 0).getTime());
  }, [myTrophies]);

  const myBadgesSorted = useMemo(() => {
    return [...myBadges].sort((a, b) => new Date(b?.earnedAt || 0).getTime() - new Date(a?.earnedAt || 0).getTime());
  }, [myBadges]);

  const stats = useMemo(() => {
    const grossScores = myRounds.map((r) => Number(r?.grossScore)).filter((n) => Number.isFinite(n));
    const points = myRounds.map((r) => Number(r?.points)).filter((n) => Number.isFinite(n));

    const birdies = sum(myRounds.map((r) => r?.birdies));
    const eagles = sum(myRounds.map((r) => r?.eagles));
    const hio = sum(myRounds.map((r) => r?.hio));
    const majors = myRounds.filter((r) => !!r?.isMajor).length;

    const best = grossScores.length ? Math.min(...grossScores) : null;
    const totalPoints = points.length ? sum(points) : 0;

    const lastRound = myRounds[0] || null;
    return { rounds: myRounds.length, totalPoints, birdies, eagles, hio, majors, best, lastRound };
  }, [myRounds]);

  const handicap =
    liveProfile?.handicap_index ??
    profile?.handicap_index ??
    profile?.handicap ??
    null;

  const handicapLabel =
    handicap === null || handicap === undefined || handicap === ""
      ? "—"
      : String(handicap);

  async function saveProfile() {
    if (!myId) return;

    const nextName = String(draftName || "").trim();
    const nextHandicapRaw = String(draftHandicap || "").trim();
    const nextHandicap = nextHandicapRaw === "" ? null : safeNum(nextHandicapRaw, null);

    if (!nextName) {
      setStatus({ type: "error", message: "Display name can’t be empty." });
      return;
    }

    setSaveLoading(true);
    setStatus({ type: "", message: "" });

    try {
      const payload = {
        id: myId,
        display_name: nextName,
        handicap_index: nextHandicap,
      };

      const { error } = await supabase.from("profiles").upsert(payload, { onConflict: "id" });
      if (error) throw error;

      // ✅ hard refresh both sources so UI sticks instantly
      await fetchLiveProfile();
      await refreshProfile(myId);

      setEditing(false);
      setStatus({ type: "success", message: "Profile updated ✅" });
    } catch (e) {
      setStatus({ type: "error", message: humanErr(e) });
    } finally {
      setSaveLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Profile" subtitle="Career cabinet, stats, and play history." />
        <Card className="p-5">
          <div className="text-sm font-semibold text-slate-600">Loading profile…</div>
        </Card>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="space-y-4">
        <PageHeader title="Profile" subtitle="Career cabinet, stats, and play history." />
        <EmptyState
          icon="🔒"
          title="Not logged in"
          description="Please log in to view and edit your profile."
          actions={
            <button
              onClick={() => navigate("/login")}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-extrabold text-white"
            >
              Go to Login
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
            onClick={() => {
              const p = liveProfile || profile || {};
              setDraftName(p?.display_name || p?.username || emailPrefix(user?.email));
              const h = p?.handicap_index ?? "";
              setDraftHandicap(h === null || h === undefined ? "" : String(h));
              setStatus({ type: "", message: "" });
              setEditing(true);
            }}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-extrabold text-white hover:bg-slate-800"
          >
            Edit Profile
          </button>
        }
      />

      {status?.message ? (
        <Card className="p-4">
          <div
            className={[
              "rounded-2xl px-4 py-3 text-sm font-semibold ring-1",
              status.type === "success"
                ? "bg-emerald-50 text-emerald-900 ring-emerald-200"
                : "bg-rose-50 text-rose-900 ring-rose-200",
            ].join(" ")}
          >
            {status.message}
          </div>
        </Card>
      ) : null}

      <Card className="p-5">
        <div className="flex items-center gap-4">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-slate-50 text-2xl ring-1 ring-slate-200">
            🙂
          </div>

          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-extrabold text-slate-900">
              {displayNameFrom(liveProfile || profile, user?.email)}
            </div>

            <div className="mt-0.5 text-xs font-semibold text-slate-600">
              Handicap:{" "}
              <span className="font-extrabold text-slate-900">{handicapLabel}</span>
            </div>

            <div className="mt-0.5 text-[11px] font-semibold text-slate-500">
              {user?.email || ""}
              {profileLoading ? <span className="ml-2 text-slate-400">· syncing…</span> : null}
            </div>
          </div>

          <div className="rounded-2xl bg-slate-50 px-3 py-2 text-xs font-extrabold text-slate-700 ring-1 ring-slate-200">
            {stats.rounds} rounds
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Points" value={stats.totalPoints} />
          <Stat label="Birdies" value={stats.birdies} />
          <Stat label="Eagles" value={stats.eagles} />
          <Stat label="Majors" value={stats.majors} />
        </div>
      </Card>

      {/* Awards */}
      <Card className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-extrabold text-slate-900">Trophy cabinet & badge wall</div>
            <div className="mt-0.5 text-xs font-semibold text-slate-600">Earned from submitted rounds.</div>
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
            {myTrophiesSorted.length ? (
              <div>
                <div className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">Trophies</div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {myTrophiesSorted.map((t) => (
                    <AchievementTile key={t.key || t.id || `${t.title}-${t.earnedAt}`} award={t} kind="trophy" />
                  ))}
                </div>
              </div>
            ) : null}

            {myBadgesSorted.length ? (
              <div>
                <div className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">Badges</div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {myBadgesSorted.map((b) => (
                    <AchievementTile key={b.key || b.id || `${b.title}-${b.earnedAt}`} award={b} kind="badge" />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </Card>

      {/* Edit modal */}
      {editing ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-xl ring-1 ring-slate-200">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-extrabold text-slate-900">Edit profile</div>
                <div className="mt-1 text-xs font-semibold text-slate-600">This edits your Supabase profile.</div>
              </div>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-extrabold text-slate-900 hover:bg-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Display name</div>
                <input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-extrabold text-slate-900 outline-none ring-emerald-200 focus:ring-4"
                />
              </div>

              <div>
                <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Handicap (optional)</div>
                <input
                  value={draftHandicap}
                  onChange={(e) => setDraftHandicap(e.target.value)}
                  inputMode="decimal"
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-extrabold text-slate-900 outline-none ring-emerald-200 focus:ring-4"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  disabled={saveLoading}
                  className="w-full rounded-xl bg-slate-100 px-4 py-2 text-sm font-extrabold text-slate-900 hover:bg-slate-200 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveProfile}
                  disabled={saveLoading}
                  className="w-full rounded-xl bg-slate-900 px-4 py-2 text-sm font-extrabold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {saveLoading ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}



