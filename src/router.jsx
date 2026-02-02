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

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />, // App renders TopNav + Outlet + BottomTabs
    children: [
      // Feed-first
      { index: true, element: <Feed /> },

      // Core tabs
      { path: "leagues", element: <League /> },
      { path: "post", element: <SubmitRound /> },
      { path: "friends", element: <FindGolfers /> },
      { path: "profile", element: <Profile /> },

      // Secondary
      { path: "rules", element: <Rules /> },
      { path: "majors", element: <Majors /> },

      // Backward-compatible redirects
      { path: "league", element: <Navigate to="/leagues" replace /> },
      { path: "submit", element: <Navigate to="/post" replace /> },
      { path: "find", element: <Navigate to="/friends" replace /> },

      // Kill marketplace
      { path: "marketplace", element: <Navigate to="/" replace /> },

      // Fallback (optional but safe)
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

export default router;
