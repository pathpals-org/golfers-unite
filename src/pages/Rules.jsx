import { useEffect, useState } from "react";
import PageHeader from "../components/ui/PageHeader";
import Card from "../components/ui/Card";
import EmptyState from "../components/ui/EmptyState";

const RULES_KEY = "leagueRules";

function getSavedRules() {
  try {
    const v = JSON.parse(localStorage.getItem(RULES_KEY));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function saveRules(rules) {
  localStorage.setItem(RULES_KEY, JSON.stringify(rules));
}

function uid() {
  return `rule_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

export default function Rules() {
  const [rulesText, setRulesText] = useState("");
  const [versions, setVersions] = useState(() => getSavedRules());

  useEffect(() => {
    saveRules(versions);
  }, [versions]);

  function handleSave() {
    if (!rulesText.trim()) return;

    const nextVersion = {
      id: uid(),
      version: versions.length + 1,
      text: rulesText.trim(),
      createdAt: new Date().toISOString(),
      published: false,
    };

    setVersions((prev) => [nextVersion, ...prev]);
    setRulesText("");
  }

  function handleDelete(id) {
    const ok = window.confirm("Delete this draft? This cannot be undone.");
    if (!ok) return;

    setVersions((prev) => prev.filter((v) => v.id !== id));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rules"
        subtitle="League rules that members must agree to."
        right={
          <button className="rounded-xl bg-white px-4 py-2 text-sm font-extrabold text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50">
            Publish New Version
          </button>
        }
      />

      {/* Editor */}
      <Card className="space-y-4 p-5">
        <textarea
          value={rulesText}
          onChange={(e) => setRulesText(e.target.value)}
          rows={8}
          placeholder="Write league rules here…"
          className="w-full resize-none rounded-xl bg-slate-50 p-4 text-sm font-semibold text-slate-900 placeholder:text-slate-400 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-600"
        />

        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500">
            Draft rules (not visible to members)
          </span>

          <button
            type="button"
            onClick={handleSave}
            disabled={!rulesText.trim()}
            className={[
              "rounded-xl px-4 py-2 text-sm font-extrabold text-white transition active:scale-[0.99]",
              rulesText.trim()
                ? "bg-emerald-600 hover:bg-emerald-500"
                : "bg-slate-300 cursor-not-allowed",
            ].join(" ")}
          >
            Save draft
          </button>
        </div>
      </Card>

      {/* Saved versions */}
      {versions.length > 0 ? (
        <div className="space-y-3">
          {versions.map((v) => (
            <Card key={v.id} className="space-y-3 p-5">
              <div className="flex items-center justify-between">
                <div className="text-sm font-extrabold text-slate-900">
                  Rules v{v.version}
                </div>

                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-extrabold text-slate-700 ring-1 ring-slate-200">
                    Draft
                  </span>

                  <button
                    type="button"
                    onClick={() => handleDelete(v.id)}
                    className="rounded-full bg-rose-50 px-3 py-1 text-xs font-extrabold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100"
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="whitespace-pre-wrap text-sm font-semibold text-slate-800">
                {v.text}
              </div>

              <div className="text-xs font-semibold text-slate-500">
                Saved {new Date(v.createdAt).toLocaleString()}
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      <EmptyState
        icon="📜"
        title="Member agreements"
        description="Once rules are published, members will be required to agree before posting in league banter."
      />
    </div>
  );
}


