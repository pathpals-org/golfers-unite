// src/router.jsx
import { createBrowserRouter, Navigate, useRouteError } from "react-router-dom";

import App from "./App";

// Pages
import Feed from "./pages/Feed";
import League from "./pages/League";
import SubmitRound from "./pages/SubmitRound";
import FindGolfers from "./pages/FindGolfers";
import Profile from "./pages/Profile";
import Rules from "./pages/Rules";
import Majors from "./pages/Majors";
import LeagueSettings from "./pages/LeagueSettings";

// Auth
import Login from "./pages/Login";
import Signup from "./pages/Signup";

function RouteError() {
  const err = useRouteError();
  const msg =
    err?.message ||
    (typeof err === "string" ? err : "") ||
    "This page crashed.";

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-10">
      <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
        <div className="text-sm font-extrabold text-slate-900">Page crashed</div>
        <div className="mt-2 text-sm font-semibold text-slate-700">
          {msg}
        </div>
        <div className="mt-4 text-xs font-mono text-slate-500 whitespace-pre-wrap">
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

const router = createBrowserRouter([
  { path: "/login", element: <Login />, errorElement: <RouteError /> },
  { path: "/signup", element: <Signup />, errorElement: <RouteError /> },

  {
    path: "/",
    element: <App />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Feed />, errorElement: <RouteError /> },

      { path: "leagues", element: <League />, errorElement: <RouteError /> },
      { path: "league-settings", element: <LeagueSettings />, errorElement: <RouteError /> },

      { path: "post", element: <SubmitRound />, errorElement: <RouteError /> },
      { path: "friends", element: <FindGolfers />, errorElement: <RouteError /> },
      { path: "profile", element: <Profile />, errorElement: <RouteError /> },

      { path: "rules", element: <Rules />, errorElement: <RouteError /> },
      { path: "majors", element: <Majors />, errorElement: <RouteError /> },

      { path: "league", element: <Navigate to="/leagues" replace /> },
      { path: "submit", element: <Navigate to="/post" replace /> },
      { path: "find", element: <Navigate to="/friends" replace /> },

      { path: "marketplace", element: <Navigate to="/" replace /> },

      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

export default router;




