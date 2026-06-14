// src/App.jsx
import { Outlet } from "react-router-dom";
import TopNav from "./components/nav/TopNav";
import BottomTabs from "./components/nav/BottomTabs";

export default function App() {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-slate-100 text-slate-900">
      {/* Background decoration */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[540px] w-[540px] -translate-x-1/2 rounded-full bg-emerald-500/10 blur-3xl" />

        <div className="absolute top-32 -left-36 h-[420px] w-[420px] rounded-full bg-sky-500/5 blur-3xl" />

        <div className="absolute bottom-0 -right-40 h-[460px] w-[460px] rounded-full bg-emerald-400/5 blur-3xl" />

        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #0f172a 1px, transparent 1px), linear-gradient(to bottom, #0f172a 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />
      </div>

      <TopNav />

      <main className="relative mx-auto w-full max-w-xl px-4 pb-40 pt-5 sm:px-5 md:max-w-2xl md:pb-12 md:pt-6 lg:max-w-3xl">
        <div className="animate-[fadeIn_250ms_ease-out]">
          <Outlet />
        </div>
      </main>

      <BottomTabs />
    </div>
  );
}