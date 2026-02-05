// src/router.jsx
import React from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";

import App from "./App";

// Pages
import Feed from "./pages/Feed";
import League from "./pages/League";
import SubmitRound from "./pages/SubmitRound";
import FindGolfers from "./pages/FindGolfers";
import Profile from "./pages/Profile";
import Rules from "./pages/Rules";
import Majors from "./pages/Majors";

// Auth pages
import Login from "./pages/Login";
import Signup from "./pages/Signup";

// Guard
import RequireAuth from "./auth/RequireAuth";

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      // Auth (public)
      { path: "login", element: <Login /> },
      { path: "signup", element: <Signup /> },

      // Protected app (must be logged in)
      {
        index: true,
        element: (
          <RequireAuth>
            <Feed />
          </RequireAuth>
        ),
      },

      {
        path: "leagues",
        element: (
          <RequireAuth>
            <League />
          </RequireAuth>
        ),
      },
      {
        path: "post",
        element: (
          <RequireAuth>
            <SubmitRound />
          </RequireAuth>
        ),
      },
      {
        path: "friends",
        element: (
          <RequireAuth>
            <FindGolfers />
          </RequireAuth>
        ),
      },
      {
        path: "profile",
        element: (
          <RequireAuth>
            <Profile />
          </RequireAuth>
        ),
      },

      // Secondary (public for now — safe)
      { path: "rules", element: <Rules /> },
      { path: "majors", element: <Majors /> },

      // Backward-compatible redirects
      { path: "league", element: <Navigate to="/leagues" replace /> },
      { path: "submit", element: <Navigate to="/post" replace /> },
      { path: "find", element: <Navigate to="/friends" replace /> },

      // Kill marketplace
      { path: "marketplace", element: <Navigate to="/" replace /> },

      // Fallback
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

export default router;


