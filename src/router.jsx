// src/router.jsx
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
import LeagueSettings from "./pages/LeagueSettings";

// Auth
import Login from "./pages/Login";
import Signup from "./pages/Signup";

const router = createBrowserRouter([
  // Auth routes OUTSIDE the App layout (no TopNav/BottomTabs)
  { path: "/login", element: <Login /> },
  { path: "/signup", element: <Signup /> },

  // Main app (with nav)
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Feed /> },

      // Main league page (your app uses /leagues as the real league page)
      { path: "leagues", element: <League /> },

      // League settings (supports query string: /league-settings?leagueId=...)
      { path: "league-settings", element: <LeagueSettings /> },

      { path: "post", element: <SubmitRound /> },
      { path: "friends", element: <FindGolfers /> },
      { path: "profile", element: <Profile /> },

      { path: "rules", element: <Rules /> },
      { path: "majors", element: <Majors /> },

      // Legacy/alias routes
      { path: "league", element: <Navigate to="/leagues" replace /> },
      { path: "submit", element: <Navigate to="/post" replace /> },
      { path: "find", element: <Navigate to="/friends" replace /> },

      // Placeholder (future)
      { path: "marketplace", element: <Navigate to="/" replace /> },

      // Fallback
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

export default router;




