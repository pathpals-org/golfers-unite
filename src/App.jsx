// src/App.jsx
import { Outlet } from "react-router-dom";
import TopNav from "./components/nav/TopNav";
import BottomTabs from "./components/nav/BottomTabs";

export default function App() {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      {/* Subtle premium glow (keeps light theme, not glass/dark) */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute top-24 left-[-120px] h-[420px] w-[420px] rounded-full bg-sky-500/5 blur-3xl" />
      </div>

      <TopNav />

      <main className="mx-auto w-full max-w-xl px-4 pb-32 pt-4 sm:px-5 md:max-w-2xl md:pb-10 lg:max-w-3xl">
        <Outlet />
      </main>

      <BottomTabs />
    </div>
  );
}
