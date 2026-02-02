// src/data/seed.js
import { DEFAULT_POINTS_SYSTEM } from "../utils/storage";

function safeUUID(prefix = "id") {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {}
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeUser({ name, locationLabel, handicap }) {
  return {
    id: safeUUID("user"),
    name,
    avatar: null,
    locationLabel,
    handicap,
    createdAt: new Date().toISOString(), // future-ready
  };
}

export function seedData() {
  const nowISO = new Date().toISOString();
  const leagueId = safeUUID("league");

  // Demo users (gives the table/feeds a real feel instantly)
  const users = [
    makeUser({ name: "Damien", locationLabel: "Lancashire", handicap: 12 }),
    makeUser({ name: "Tom", locationLabel: "Manchester", handicap: 18 }),
    makeUser({ name: "Kyle", locationLabel: "Bolton", handicap: 9 }),
    makeUser({ name: "Ryan", locationLabel: "Preston", handicap: 15 }),
    makeUser({ name: "Josh", locationLabel: "Liverpool", handicap: 22 }),
    makeUser({ name: "Callum", locationLabel: "Wigan", handicap: 6 }),
  ];

  const hostId = users[0].id; // Damien = host

  // Keep it simple: start from DEFAULT and override only what you care about.
  const pointsSystem = {
    ...DEFAULT_POINTS_SYSTEM,
    placementPoints: { 1: 3, 2: 2, 3: 0 },
    participation: { enabled: false, points: 1 },
    bonuses: {
      enabled: false,
      birdie: { enabled: false, points: 1 },
      eagle: { enabled: false, points: 2 },
      hio: { enabled: false, points: 5 },
    },
  };

  return {
    // Storage schema version (helps later if you change shapes)
    appVersion: 1,
    seededAtISO: nowISO,

    users,

    league: {
      id: leagueId,
      name: "Saturday Mates League",
      seasonStartISO: nowISO,
      createdAt: nowISO,
      schemaVersion: 1,

      members: users.map((u) => u.id),
      hostId,

      // ✅ NEW SYSTEM SOURCE OF TRUTH
      pointsSystem,

      rulesText: "Play fair. Buy the first round.",
      rulesVersion: 1,
      agreedBy: [hostId],

      majorsCalendar: [
        {
          id: safeUUID("major"),
          name: "The Masters",
          dateISO: "2026-04-10",
          multiplier: 2,
          isDefault: true,
        },
      ],
    },

    // Empty datasets (your app expects these shapes)
    rounds: [],

    // League end-season uses trophies as an ARRAY (keep it as array here)
    trophies: [],

    // SubmitRound uses badges as a MAP keyed by playerId (must be object)
    badges: {},

    listings: [],
    listingMessages: [],
    watchlist: [],
    playPosts: [],
    playRequests: [],
    seasonArchives: [],
  };
}



