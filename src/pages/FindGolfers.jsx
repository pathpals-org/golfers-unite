import PageHeader from "../components/ui/PageHeader";
import Card from "../components/ui/Card";
import EmptyState from "../components/ui/EmptyState";

export default function FindGolfers() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Find Golfers"
        subtitle="Looking for a round? Find players near you."
        right={
          <button className="rounded-xl bg-white/10 px-4 py-2 text-sm hover:bg-white/15">
            Create Post
          </button>
        }
      />

      <Card className="p-5 grid gap-3 md:grid-cols-2">
        {[
          "When",
          "Holes (9/18)",
          "Radius (miles)",
          "Location",
          "Vibe",
          "Note",
        ].map((field) => (
          <div
            key={field}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300"
          >
            {field}
          </div>
        ))}
      </Card>

      <EmptyState
        icon="👥"
        title="Open posts feed"
        description="Browse upcoming rounds and request to join."
      />
    </div>
  );
}
