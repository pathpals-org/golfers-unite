// src/components/ui/PageHeader.jsx
export default function PageHeader({ kicker, title, subtitle, right }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        {kicker ? (
          <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
            {kicker}
          </div>
        ) : null}

        <h1 className="mt-0.5 text-lg font-extrabold text-slate-900 sm:text-xl">
          {title}
        </h1>

        {subtitle ? (
          <div className="mt-0.5 text-sm font-semibold text-slate-600">
            {subtitle}
          </div>
        ) : null}
      </div>

      {right ? (
        <div className="flex shrink-0 items-center gap-2">{right}</div>
      ) : null}
    </div>
  );
}




