// src/components/nav/BottomTabs.jsx
import { NavLink, useLocation } from "react-router-dom";

const tabs = [
  { to: "/", label: "Feed", icon: "🏌️" },
  { to: "/leagues", label: "Leagues", icon: "🏆" },
  { to: "/post", label: "Post", icon: "➕", primary: true },
  { to: "/friends", label: "Friends", icon: "👥" },
  { to: "/profile", label: "Profile", icon: "🙂" },
];

function isActivePath(pathname, to) {
  if (to === "/") return pathname === "/";
  return pathname.startsWith(to);
}

function isAuthRoute(pathname) {
  return pathname === "/login" || pathname === "/signup";
}

export default function BottomTabs() {
  const { pathname } = useLocation();

  // Hide tabs on auth pages
  if (isAuthRoute(pathname)) return null;

  return (
    <nav
      className="fixed inset-x-0 z-50 md:hidden"
      style={{
        bottom: "env(safe-area-inset-bottom)",
      }}
      aria-label="Primary navigation"
    >
      <div className="mx-auto w-full max-w-xl px-3 pb-[calc(env(safe-area-inset-bottom)+10px)]">
        <div className="relative rounded-2xl border border-slate-200 bg-white/92 backdrop-blur shadow-[0_10px_35px_rgba(2,6,23,0.10)]">
          {/* subtle top highlight */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />

          <div className="grid grid-cols-5 px-2 py-2">
            {tabs.map((t) => {
              const active = isActivePath(pathname, t.to);

              if (t.primary) {
                return (
                  <NavLink
                    key={t.to}
                    to={t.to}
                    className="relative -mt-7 flex flex-col items-center"
                    aria-label={t.label}
                  >
                    <span
                      className={[
                        "grid h-14 w-14 place-items-center rounded-full text-2xl",
                        "shadow-[0_10px_25px_rgba(2,6,23,0.20)] ring-4 ring-slate-100",
                        "active:scale-95 transition",
                        active
                          ? "bg-slate-900 text-white"
                          : "bg-emerald-600 text-white hover:bg-emerald-500",
                      ].join(" ")}
                    >
                      {t.icon}
                    </span>

                    <span
                      className={[
                        "mt-1 text-[11px] font-extrabold tracking-tight",
                        active ? "text-slate-900" : "text-slate-700",
                      ].join(" ")}
                    >
                      {t.label}
                    </span>
                  </NavLink>
                );
              }

              return (
                <NavLink
                  key={t.to}
                  to={t.to}
                  className={[
                    "relative flex h-12 flex-col items-center justify-center gap-0.5 rounded-xl px-2 transition",
                    active
                      ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                  ].join(" ")}
                  aria-label={t.label}
                >
                  {/* active dot indicator */}
                  <span
                    className={[
                      "absolute top-1 h-1 w-6 rounded-full transition",
                      active ? "bg-emerald-600" : "bg-transparent",
                    ].join(" ")}
                  />
                  <span className="text-lg leading-none">{t.icon}</span>
                  <span className="text-[11px] font-extrabold tracking-tight">
                    {t.label}
                  </span>
                </NavLink>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
}
