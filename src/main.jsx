import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import router from "./router";
import "./index.css";

import { seedIfNeeded } from "./utils/storage";
import { AuthProvider } from "./auth/useAuth";

// Bootstrap once (safe in dev + StrictMode)
seedIfNeeded();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </React.StrictMode>
);




