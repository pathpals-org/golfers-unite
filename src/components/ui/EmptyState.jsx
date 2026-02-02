// src/components/ui/EmptyState.jsx
import Card from "./Card";

export default function EmptyState({
  icon = "🏌️",
  title,
  description,
  action,
  actions, // small compat: some pages may pass `actions`
}) {
  const actionNode = action ?? actions;

  return (
    <Card className="p-6 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-50 text-2xl ring-1 ring-slate-200">
        {icon}
      </div>

      {title ? (
        <div className="mt-4 text-base font-extrabold text-slate-900">
          {title}
        </div>
      ) : null}

      {description ? (
        <p className="mt-1 text-sm font-semibold leading-relaxed text-slate-600">
          {description}
        </p>
      ) : null}

      {actionNode ? <div className="mt-5">{actionNode}</div> : null}
    </Card>
  );
}



