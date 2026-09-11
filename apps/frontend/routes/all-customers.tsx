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
import { useStore } from "@/lib/store";
import { STATUS_LABEL, type CustomerStatus } from "@/lib/types";

export const Route = createFileRoute("/all-customers")({
  head: () => ({
    meta: [
      { title: "All Customers — Northrail Contact Desk" },
      {
        name: "description",
        content:
          "Search the full customer database by name, BCN, owner, tier or contact status. Accounts owned by other salespeople are read-only.",
      },
      { property: "og:title", content: "All Customers — Northrail Contact Desk" },
      {
        property: "og:description",
        content: "The complete customer master data set with ownership and contact status.",
      },
    ],
  }),
  component: AllCustomers,
});

function AllCustomers() {
  const { customers, users } = useStore();
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("all");
  const [status, setStatus] = useState("all");
  const [tier, setTier] = useState("all");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customers
      .filter((c) => {
        if (q && !c.customerName.toLowerCase().includes(q) && !c.bcn.toLowerCase().includes(q)) return false;
        if (owner === "unassigned" && c.ownerId) return false;
        if (owner !== "all" && owner !== "unassigned" && c.ownerId !== owner) return false;
        if (status !== "all" && c.status !== status) return false;
        if (tier !== "all" && c.propensityTier !== tier) return false;
        return true;
      })
      .sort((a, b) => a.propensityRank - b.propensityRank);
  }, [customers, query, owner, status, tier]);

  return (
    <>
      <PageHeader
        title="All Customers"
        description="Full customer database. Accounts owned by another salesperson open read-only."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search name or BCN…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs bg-surface"
        />
        <Select value={owner} onValueChange={setOwner}>
          <SelectTrigger className="w-48 bg-surface">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any owner</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            {users
              .filter((u) => u.role === "sales")
              .map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-48 bg-surface">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any status</SelectItem>
            {(Object.keys(STATUS_LABEL) as CustomerStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={tier} onValueChange={setTier}>
          <SelectTrigger className="w-40 bg-surface">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any tier</SelectItem>
            <SelectItem value="A">Tier A</SelectItem>
            <SelectItem value="B">Tier B</SelectItem>
            <SelectItem value="C">Tier C</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto text-sm text-muted-foreground">{rows.length} of {customers.length}</span>
      </div>

      <CustomerTable rows={rows} />
    </>
  );
}
