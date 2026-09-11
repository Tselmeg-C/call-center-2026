import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, CalendarClock, CircleDashed, PhoneOff, Users2 } from "lucide-react";
import { useMemo, useState } from "react";
import { CustomerTable } from "@/components/CustomerTable";
import { PageHeader } from "@/components/PageHeader";
import { BUCKET_LABEL, BUCKET_ORDER, bucketOf, type Bucket } from "@/lib/derive";
import { useStore } from "@/lib/store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Today's Outreach — Northrail Contact Desk" },
      {
        name: "description",
        content:
          "Sales dashboard for overdue follow-ups, calls due today and never-contacted accounts in the Northrail customer contact desk.",
      },
      { property: "og:title", content: "Today's Outreach — Northrail Contact Desk" },
      {
        property: "og:description",
        content: "Work your assigned customers by priority: overdue, due today, undated and never contacted.",
      },
    ],
  }),
  component: Dashboard,
});

const icons: Record<Bucket, typeof Users2> = {
  overdue: AlertTriangle,
  today: CalendarClock,
  undated: CircleDashed,
  never: PhoneOff,
  other: Users2,
};

const accents: Record<Bucket, string> = {
  overdue: "text-destructive",
  today: "text-info",
  undated: "text-warning",
  never: "text-muted-foreground",
  other: "text-primary",
};

function Dashboard() {
  const { currentUser, customers, activities, followUps } = useStore();
  const [selected, setSelected] = useState<Bucket>("overdue");

  const mine = useMemo(
    () => customers.filter((c) => c.ownerId === currentUser.id && c.status !== "closed"),
    [customers, currentUser.id],
  );

  const grouped = useMemo(() => {
    const map = new Map<Bucket, typeof mine>(BUCKET_ORDER.map((b) => [b, []]));
    for (const c of mine) {
      const b = bucketOf(c, followUps, activities.some((a) => a.bcn === c.bcn));
      map.get(b)!.push(c);
    }
    return map;
  }, [mine, followUps, activities]);

  return (
    <>
      <PageHeader
        title={`Today, ${currentUser.name.split(" ")[0]}`}
        description={
          currentUser.role === "admin"
            ? "Admin view — switch to a sales account in the sidebar to see a personal queue."
            : `${mine.length} active customers assigned to you.`
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {BUCKET_ORDER.map((bucket) => {
          const Icon = icons[bucket];
          const count = grouped.get(bucket)!.length;
          const active = selected === bucket;
          return (
            <button
              key={bucket}
              onClick={() => setSelected(bucket)}
              className={`rounded-lg border bg-surface p-4 text-left shadow-panel transition-colors ${
                active ? "border-primary ring-1 ring-primary/30" : "border-border hover:border-primary/40"
              }`}
            >
              <Icon className={`size-4 ${accents[bucket]}`} />
              <p className="mt-3 text-3xl font-semibold tracking-tight">{count}</p>
              <p className="mt-1 text-xs leading-snug text-muted-foreground">{BUCKET_LABEL[bucket]}</p>
            </button>
          );
        })}
      </div>

      <div className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {BUCKET_LABEL[selected]}
        </h2>
        <CustomerTable
          rows={grouped.get(selected)!}
          showOwner={false}
          emptyLabel="Nothing in this bucket right now."
        />
      </div>
    </>
  );
}
