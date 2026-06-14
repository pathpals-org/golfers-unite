// src/components/nav/TopNav.jsx
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { signOut, hardSignOut } from "../../auth/auth";

const main = [
  { to: "/leagues", label: "Leagues" },
  { to: "/post", label: "Post Round" },
  { to: "/friends", label: "Friends" },
  { to: "/profile", label: "Profile" },
];

const secondary = [
  { to: "/rules", label: "Rules", icon: "📜" },
  { to: "/majors", label: "Majors", icon: "🏆" },
];

function isActivePath(to, pathname) {
  if (to === "/") return pathname === "/";
  return pathname.startsWith(to);
}

function isAuthRoute(pathname) {
  return (
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password"
  );
}

export default function TopNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, loading, profile } = useAuth();

  if (isAuthRoute(pathname)) return null;

  const displayName =
    profile?.display_name ||
    profile?.username ||
    user?.email?.split("@")?.[0] ||
    "Golfer";

  const initial = String(displayName).charAt(0).toUpperCase();

  async function handleLogout() {
    try {
      await signOut();
      navigate("/login", { replace: true });
    } catch (error) {
      console.error("Logout failed, forcing hard sign out:", error);
      await hardSignOut();
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 shadow-sm backdrop-blur-xl">
      <div className="mx-auto w-full max-w-3xl px-4 py-3 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <NavLink
            to="/leagues"
            className="flex min-w-0 items-center gap-3"
          >
            <div className="relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-2xl bg-emerald-600 text-lg text-white shadow-sm ring-1 ring-emerald-700/20">
              <span className="relative z-10">⛳</span>
              <span className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/25 to-transparent" />
            </div>

            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-black tracking-tight text-slate-950">
                Golfers Unite
              </div>

              <div className="hidden truncate text-[11px] font-semibold text-slate-500 sm:block">
                Leagues, scores and banter
              </div>
            </div>
          </NavLink>

          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden items-center gap-2 sm:flex">
              {secondary.map((item) => {
                const active = isActivePath(item.to, pathname);

                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={[
                      "inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-extrabold ring-1 transition",
                      active
                        ? "bg-emerald-600 text-white ring-emerald-600 shadow-sm"
                        : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
                    ].join(" ")}
                  >
                    <span className="text-sm leading-none">
                      {item.icon}
                    </span>
                    {item.label}
                  </NavLink>
                );
              })}
            </div>

            {user ? (
              <>
                <NavLink
                  to="/profile"
                  aria-label="Open profile"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-black text-white shadow-sm ring-2 ring-white"
                >
                  {initial}
                </NavLink>

                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={loading}
                  className={[
                    "inline-flex shrink-0 items-center rounded-full px-3 py-2 text-xs font-extrabold ring-1 transition",
                    loading
                      ? "cursor-not-allowed bg-slate-100 text-slate-400 ring-slate-200"
                      : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
                  ].join(" ")}
                >
                  Log out
                </button>
              </>
            ) : (
              <NavLink
                to="/login"
                className="inline-flex items-center rounded-full bg-slate-900 px-3 py-2 text-xs font-extrabold text-white shadow-sm transition hover:bg-slate-800"
              >
                Log in
              </NavLink>
            )}
          </div>
        </div>

        {user ? (
          <div className="mt-3 hidden items-center gap-2 md:flex">
            {main.map((item) => {
              const active = isActivePath(item.to, pathname);

              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={[
                    "rounded-full px-3 py-2 text-xs font-extrabold ring-1 transition",
                    active
                      ? "bg-slate-900 text-white ring-slate-900 shadow-sm"
                      : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
                  ].join(" ")}
                >
                  {item.label}
                </NavLink>
              );
            })}

            <div className="ml-auto text-xs font-semibold text-slate-500">
              Signed in as{" "}
              <span className="font-extrabold text-slate-800">
                {displayName}
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </header>
  );
}