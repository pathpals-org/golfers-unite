// src/components/nav/BottomTabs.jsx
import { NavLink, useLocation } from "react-router-dom";

const tabs = [
  { to: "/leagues", label: "Leagues", icon: "🏆" },
  { to: "/friends", label: "Friends", icon: "👥" },
  { to: "/post", label: "Post", icon: "＋", primary: true },
  { to: "/rules", label: "Rules", icon: "📜" },
  { to: "/profile", label: "Profile", icon: "🙂" },
];

function isActivePath(pathname, to) {
  if (to === "/leagues") {
    return (
      pathname === "/leagues" ||
      pathname.startsWith("/league/")
    );
  }

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

export default function BottomTabs() {
  const { pathname } = useLocation();

  if (isAuthRoute(pathname)) return null;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 md:hidden"
      aria-label="Primary navigation"
    >
      <div className="mx-auto w-full max-w-xl px-3 pb-[calc(env(safe-area-inset-bottom)+10px)]">
        <div className="relative overflow-visible rounded-3xl border border-slate-200/80 bg-white/95 shadow-[0_16px_45px_rgba(15,23,42,0.16)] backdrop-blur-xl">
          <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/70 to-transparent" />

          <div className="grid grid-cols-5 items-end px-2 py-2">
            {tabs.map((tab) => {
              const active = isActivePath(pathname, tab.to);

              if (tab.primary) {
                return (
                  <NavLink
                    key={tab.to}
                    to={tab.to}
                    aria-label={tab.label}
                    className="relative -mt-7 flex flex-col items-center justify-end"
                  >
                    <span
                      className={[
                        "grid h-15 w-15 place-items-center rounded-full text-3xl font-light text-white",
                        "ring-4 ring-slate-100 shadow-[0_12px_30px_rgba(5,150,105,0.35)]",
                        "transition duration-200 active:scale-95",
                        active
                          ? "bg-slate-900"
                          : "bg-emerald-600 hover:bg-emerald-500",
                      ].join(" ")}
                    >
                      {tab.icon}
                    </span>

                    <span
                      className={[
                        "mt-1 text-[11px] font-extrabold tracking-tight",
                        active
                          ? "text-emerald-700"
                          : "text-slate-700",
                      ].join(" ")}
                    >
                      {tab.label}
                    </span>
                  </NavLink>
                );
              }

              return (
                <NavLink
                  key={tab.to}
                  to={tab.to}
                  aria-label={tab.label}
                  className={[
                    "relative flex h-14 flex-col items-center justify-center gap-1 rounded-2xl px-1 transition duration-200",
                    active
                      ? "bg-emerald-50 text-emerald-800"
                      : "text-slate-500 hover:bg-slate-50 hover:text-slate-900",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "absolute top-1 h-1 w-7 rounded-full transition",
                      active
                        ? "bg-emerald-600"
                        : "bg-transparent",
                    ].join(" ")}
                  />

                  <span
                    className={[
                      "text-lg leading-none transition",
                      active ? "scale-110" : "",
                    ].join(" ")}
                  >
                    {tab.icon}
                  </span>

                  <span className="text-[10px] font-extrabold tracking-tight">
                    {tab.label}
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