// src/components/ui/SectionHeader.jsx
export default function SectionHeader({ title, right }) {
  return (
    <div className="mt-6 mb-2 flex items-center justify-between gap-3">
      <h2 className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
        {title}
      </h2>

      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}
