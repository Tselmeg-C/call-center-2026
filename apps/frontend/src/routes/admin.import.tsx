import { createFileRoute } from "@tanstack/react-router";
import { FileSpreadsheet, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dateTime } from "@/lib/derive";
import { RequireAdmin } from "@/lib/guards";
import { useStore } from "@/lib/store";
import type { ImportJob } from "@/lib/types";

export const Route = createFileRoute("/admin/import")({
  head: () => ({
    meta: [
      { title: "Excel Import — Northrail Admin" },
      {
        name: "description",
        content: "Upload the customer Excel export. Rows are upserted by BCN; activities, notes and ownership are never overwritten.",
      },
      { property: "og:title", content: "Excel Import — Northrail Admin" },
      { property: "og:description", content: "Import customer master data and review row-level results." },
    ],
  }),
  component: AdminImport,
});

function AdminImport() {
  const { importJobs, recordImport } = useStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<ImportJob | null>(null);

  return (
    <RequireAdmin>
      <PageHeader
        title="Excel Import"
        description="Upsert by BCN. Master data is updated; activities, notes, follow-ups and ownership stay untouched."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Upload file</CardTitle>
          </CardHeader>
          <CardContent>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-input bg-muted/40 px-6 py-12 text-center transition-colors hover:border-primary/50">
              <Upload className="size-6 text-muted-foreground" />
              <span className="text-sm font-medium">Choose an .xlsx file</span>
              <span className="text-xs text-muted-foreground">
                Expected columns: bcn, MBCN, customer_name, phone, propensity_*, revenue and FEM amounts, vendor and
                category pairs.
              </span>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const job = await recordImport(file);
                  if (inputRef.current) inputRef.current.value = "";
                  if (!job) return;
                  setResult(job);
                  toast.success("Import completed", { description: `${job.rowsProcessed} rows processed` });
                }}
              />
            </label>

            {result && (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Rows processed" value={result.rowsProcessed} />
                <Stat label="Created" value={result.created} />
                <Stat label="Updated" value={result.updated} />
                <Stat label="Errors" value={result.errors.length} tone="text-destructive" />
              </div>
            )}
            {result && result.errors.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm text-destructive">
                {result.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Import history</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {importJobs.map((job) => (
              <div key={job.id} className="rounded-md border border-border p-3">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="size-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{job.fileName}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{dateTime(job.at)}</span>
                </div>
                <p className="mt-2 font-mono text-xs text-muted-foreground">
                  {job.rowsProcessed} rows · {job.created} created · {job.updated} updated · {job.errors.length} errors
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </RequireAdmin>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className={`text-xl font-semibold ${tone ?? ""}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
