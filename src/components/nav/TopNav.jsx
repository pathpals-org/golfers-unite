// src/components/nav/TopNav.jsx
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { signOut } from "../../auth/auth";

const main = [
  { to: "/", label: "Feed" },
  { to: "/leagues", label: "Leagues" },
  { to: "/post", label: "Post" },
  { to: "/friends", label: "Friends" },
  { to: "/profile", label: "Profile" },
];

const secondary = [
  { to: "/rules", label: "Rules", icon: "📜" },
  { to: "/majors", label: "Majors", icon: "🏟️" },
];

function isActivePath(to, pathname) {
  if (to === "/") return pathname === "/";
  return pathname.startsWith(to);
}

function isAuthRoute(pathname) {
  return pathname === "/login" || pathname === "/signup";
}

export default function TopNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  // Hide top nav on auth pages (cleaner auth UI)
  if (isAuthRoute(pathname)) return null;

  const handleLogout = async () => {
    try {
      await signOut();

      // Replace so you can’t “Back” into protected pages
      navigate("/login", { replace: true });

      // Hard refresh to kill any stale cached state in memory
      setTimeout(() => {
        try {
          window.location.reload();
        } catch {
          // ignore
        }
      }, 50);
    } catch (e) {
      console.error("Logout failed:", e);
    }
  };

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/92 backdrop-blur">
      <div className="mx-auto w-full max-w-3xl px-4 py-3 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          {/* Brand */}
          <div className="flex items-center gap-2">
            <div className="relative grid h-9 w-9 place-items-center rounded-xl bg-emerald-600 text-white shadow-sm ring-1 ring-emerald-700/20">
              <span className="relative z-10">⛳</span>
              <span className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-b from-white/20 to-transparent" />
            </div>

            <div className="leading-tight">
              <div className="text-sm font-extrabold tracking-tight text-slate-900">
                Golfers Unite
              </div>
              <div className="text-[11px] font-semibold text-slate-500">
                Golf-only banter & leagues
              </div>
            </div>
          </div>

          {/* Right side actions */}
          <div className="flex items-center gap-2">
            {secondary.map((l) => {
              const active = isActivePath(l.to, pathname);
              return (
                <NavLink
                  key={l.to}
                  to={l.to}
                  className={[
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-extrabold ring-1 transition",
                    active
                      ? "bg-emerald-600 text-white ring-emerald-600"
                      : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
                  ].join(" ")}
                >
                  <span className="text-sm leading-none">{l.icon}</span>
                  {l.label}
                </NavLink>
              );
            })}

            {!user ? (
              <NavLink
                to="/login"
                className="inline-flex items-center rounded-full bg-slate-900 px-3 py-2 text-xs font-extrabold text-white ring-1 ring-slate-900 transition hover:opacity-95"
              >
                Log in
              </NavLink>
            ) : (
              <button
                type="button"
                onClick={handleLogout}
                disabled={loading}
                className={[
                  "inline-flex items-center rounded-full px-3 py-2 text-xs font-extrabold ring-1 transition",
                  loading
                    ? "bg-slate-100 text-slate-400 ring-slate-200 cursor-not-allowed"
                    : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
                ].join(" ")}
              >
                Log out
              </button>
            )}
          </div>
        </div>

        {/* Desktop main nav (only useful when logged in) */}
        <div className="mt-3 hidden md:flex items-center gap-2">
          {main.map((l) => {
            const active = isActivePath(l.to, pathname);
            if (!user) return null;

            return (
              <NavLink
                key={l.to}
                to={l.to}
                className={[
                  "rounded-full px-3 py-2 text-xs font-extrabold ring-1 transition",
                  active
                    ? "bg-slate-900 text-white ring-slate-900"
                    : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
                ].join(" ")}
              >
                {l.label}
              </NavLink>
            );
          })}
        </div>
      </div>

      <div className="pointer-events-none h-px w-full bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
    </header>
  );
}




