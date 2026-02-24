// src/router.jsx
import React from "react";
import {
  createBrowserRouter,
  Navigate,
  useLocation,
  useRouteError,
} from "react-router-dom";

import App from "./App";

// Pages
import League from "./pages/League";
import SubmitRound from "./pages/SubmitRound";
import FindGolfers from "./pages/FindGolfers";
import Profile from "./pages/Profile";
import Rules from "./pages/Rules";
import Majors from "./pages/Majors";
import LeagueSettings from "./pages/LeagueSettings";
import BanterPage from "./pages/BanterPage";

// Auth
import Login from "./pages/Login";
import Signup from "./pages/Signup";

import { useAuth } from "./auth/useAuth";

function RouteError() {
  const err = useRouteError();
  const msg =
    err?.message || (typeof err === "string" ? err : "") || "This page crashed.";

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-10">
      <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
        <div className="text-sm font-extrabold text-slate-900">Page crashed</div>
        <div className="mt-2 text-sm font-semibold text-slate-700">{msg}</div>
        <div className="mt-4 whitespace-pre-wrap text-xs font-mono text-slate-500">
          {err?.stack || ""}
        </div>
        <a
          className="mt-4 inline-block rounded-xl bg-slate-900 px-4 py-2 text-sm font-extrabold text-white"
          href="/"
        >
          Back to home
        </a>
      </div>
    </div>
  );
}

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  // While auth is hydrating, don’t render pages that depend on user id.
  if (loading) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-10">
        <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
          <div className="text-sm font-extrabold text-slate-900">Loading…</div>
          <div className="mt-2 text-sm font-semibold text-slate-700">
            Checking your session.
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  return children;
}

const router = createBrowserRouter([
  { path: "/login", element: <Login />, errorElement: <RouteError /> },
  { path: "/signup", element: <Signup />, errorElement: <RouteError /> },

  {
    path: "/",
    element: <App />,
    errorElement: <RouteError />,
    children: [
      // ✅ Feed removed for now (prevents localStorage public bleed).
      // Land on leagues instead.
      {
        index: true,
        element: (
          <RequireAuth>
            <Navigate to="/leagues" replace />
          </RequireAuth>
        ),
        errorElement: <RouteError />,
      },

      // ✅ League pages require auth because they depend on user + memberships
      {
        path: "leagues",
        element: (
          <RequireAuth>
            <League />
          </RequireAuth>
        ),
        errorElement: <RouteError />,
      },
      {
        path: "league-settings",
        element: (
          <RequireAuth>
            <LeagueSettings />
          </RequireAuth>
        ),
        errorElement: <RouteError />,
      },

      // ✅ Per-league banter (auth + league membership enforced by RLS)
      {
        path: "league/:leagueId/banter",
        element: (
          <RequireAuth>
            <BanterPage />
          </RequireAuth>
        ),
        errorElement: <RouteError />,
      },

      {
        path: "post",
        element: (
          <RequireAuth>
            <SubmitRound />
          </RequireAuth>
        ),
        errorElement: <RouteError />,
      },
      {
        path: "friends",
        element: (
          <RequireAuth>
            <FindGolfers />
          </RequireAuth>
        ),
        errorElement: <RouteError />,
      },
      {
        path: "profile",
        element: (
          <RequireAuth>
            <Profile />
          </RequireAuth>
        ),
        errorElement: <RouteError />,
      },

      { path: "rules", element: <Rules />, errorElement: <RouteError /> },
      { path: "majors", element: <Majors />, errorElement: <RouteError /> },

      { path: "league", element: <Navigate to="/leagues" replace /> },
      { path: "submit", element: <Navigate to="/post" replace /> },
      { path: "find", element: <Navigate to="/friends" replace /> },

      // Keep old link target harmless
      { path: "marketplace", element: <Navigate to="/leagues" replace /> },

      { path: "*", element: <Navigate to="/leagues" replace /> },
    ],
  },
]);

export default router;



