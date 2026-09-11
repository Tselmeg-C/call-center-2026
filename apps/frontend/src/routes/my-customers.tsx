import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CustomerTable } from "@/components/CustomerTable";
import { PageHeader } from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { BUCKET_ORDER, bucketOf } from "@/lib/derive";
import { useStore } from "@/lib/store";

export const Route = createFileRoute("/my-customers")({
  head: () => ({
    meta: [
      { title: "My Customers — Northrail Contact Desk" },
      {
        name: "description",
        content: "Your assigned customer workload, ordered by follow-up urgency and propensity ranking.",
      },
      { property: "og:title", content: "My Customers — Northrail Contact Desk" },
      {
        property: "og:description",
        content: "Search, filter and prioritise the accounts currently assigned to you.",
      },
    ],
  }),
  component: MyCustomers,
});

function MyCustomers() {
  const { currentUser, customers, activities, followUps } = useStore();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("priority");
  const [showClosed, setShowClosed] = useState(false);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = customers.filter(
      (c) =>
        c.ownerId === currentUser.id &&
        (showClosed || c.status !== "closed") &&
        (!q || c.customerName.toLowerCase().includes(q) || c.bcn.toLowerCase().includes(q)),
    );
    return list.sort((a, b) => {
      if (sort === "revenue") return b.revenue[2025] - a.revenue[2025];
      if (sort === "name") return a.customerName.localeCompare(b.customerName);
      if (sort === "propensity") return a.propensityRank - b.propensityRank;
      const ai = BUCKET_ORDER.indexOf(bucketOf(a, followUps, activities.some((x) => x.bcn === a.bcn)));
      const bi = BUCKET_ORDER.indexOf(bucketOf(b, followUps, activities.some((x) => x.bcn === b.bcn)));
      return ai - bi || a.propensityRank - b.propensityRank;
    });
  }, [customers, currentUser.id, query, showClosed, sort, followUps, activities]);

  return (
    <>
      <PageHeader
        title="My Customers"
        description="Everything currently assigned to you, prioritised by follow-up urgency."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search name or BCN…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs bg-surface"
        />
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="w-52 bg-surface">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="priority">Sort: default priority</SelectItem>
            <SelectItem value="propensity">Sort: propensity rank</SelectItem>
            <SelectItem value="revenue">Sort: revenue 2025</SelectItem>
            <SelectItem value="name">Sort: customer name</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Switch id="closed" checked={showClosed} onCheckedChange={setShowClosed} />
          <Label htmlFor="closed" className="text-sm text-muted-foreground">
            Include closed
          </Label>
        </div>
        <span className="ml-auto text-sm text-muted-foreground">{rows.length} customers</span>
      </div>

      <CustomerTable rows={rows} showOwner={false} emptyLabel="No customers assigned to this account yet." />
    </>
  );
}
