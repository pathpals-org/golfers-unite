import PageHeader from "../components/ui/PageHeader";
import Card from "../components/ui/Card";
import EmptyState from "../components/ui/EmptyState";

export default function Majors() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Majors"
        subtitle="Default majors and custom major events."
        right={
          <button className="rounded-xl bg-white/10 px-4 py-2 text-sm hover:bg-white/15">
            Add Major
          </button>
        }
      />

      <Card className="p-5">
        <div className="grid gap-3 md:grid-cols-2">
          {["Masters", "PGA Championship", "U.S. Open", "The Open"].map(
            (major) => (
              <div
                key={major}
                className="rounded-xl border border-white/10 bg-white/5 p-4"
              >
                <div className="font-semibold">{major}</div>
                <div className="text-xs text-slate-300">Multiplier x1.5</div>
              </div>
            )
          )}
        </div>
      </Card>

      <EmptyState
        icon="⭐"
        title="Custom majors"
        description="Add, edit, and remove custom major days with date and multiplier."
      />
    </div>
  );
}
