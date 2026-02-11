import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import router from "./router";
import "./index.css";

import { seedIfNeeded } from "./utils/storage";
import { AuthProvider } from "./auth/useAuth";

// ✅ DEV ONLY: seed local demo data
if (import.meta.env.DEV) {
  seedIfNeeded();
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </React.StrictMode>
);





