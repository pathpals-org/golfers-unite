// src/components/ui/Card.jsx
export default function Card({ children, className = "" }) {
  return (
    <div
      className={[
        "rounded-2xl bg-white",
        "ring-1 ring-slate-200",
        "shadow-sm",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

