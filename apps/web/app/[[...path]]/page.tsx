"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Typography } from "antd";
import { useServices } from "../../services/provider";
import { workloadBuckets, type ClosureReason, type Customer, type CustomerDetail, type FollowUpType, type ImportResult, type Result, type SampleRecord, type Scenario, type User, type WorkloadBucket, type WorkloadCustomer, type WorkloadData } from "../../services/types";

const routes = [
  ["/dashboard", "Dashboard", "Sales"],
  ["/customers/mine", "My Customers", "Sales"],
  ["/customers", "All Customers", "Both"],
  ["/admin/users", "Users", "Admin"],
  ["/admin/closure-reasons", "Closure Reasons", "Admin"],
  ["/admin/import", "Excel Import", "Admin"],
  ["/admin/assignments", "Assignments", "Admin"],
  ["/admin/reports", "Reports", "Admin"],
  ["/admin/audit", "Audit", "Admin"],
] as const;
const landing = (user: User) => user.role === "Admin" ? "/customers" : "/dashboard";
const bucketLabels: Record<WorkloadBucket, string> = { overdue: "Overdue", today: "Due today", undated: "Undated follow-up", "never-contacted": "Never contacted", other: "Other" };

function MockPanel() {
  const { controls } = useServices();
  const router = useRouter();
  const snapshot = useSyncExternalStore(controls.subscribe, controls.getSnapshot, controls.getSnapshot);
  return <fieldset>
    <legend>Mock controls — demonstration only</legend>
    <label htmlFor="scenario">Scenario</label>{" "}
    <select id="scenario" value={snapshot.scenario} onChange={event => {
      controls.setScenario(event.target.value as Scenario);
      if (event.target.value === "Expired session") router.replace("/login");
    }}>
      {["Normal", "Loading", "Empty", "Error", "Expired session"].map(value => <option key={value}>{value}</option>)}
    </select>{" "}
    <button onClick={() => { controls.reset(); router.replace("/login"); }}>Reset mock state</button>
    <p>Selected scenario: {snapshot.scenario}</p>
  </fieldset>;
}

function SignIn() {
  const { services, controls } = useServices();
  const [persona, setPersona] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(false);
  // Unmounting on reset or session changes prevents late sign-in UI updates.
  async function submit() {
    if (pending) return;
    if (!persona) { setError("Select a persona to sign in."); return; }
    setPending(true); setError(""); setRetry(false);
    const result = await services.signIn(persona);
    setPending(false);
    if (!result.ok) { setError(result.error.message); setRetry(result.error.code === "request-failure"); }
  }
  return <>
    <Typography.Title level={1}>Call Center</Typography.Title>
    <h2>Sign in</h2>
    <p>Mock prototype — choose a synthetic persona. No real account is needed.</p>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label htmlFor="persona">Persona</label>{" "}
      <select id="persona" value={persona} disabled={pending} aria-describedby={error ? "signin-error" : undefined} onChange={event => setPersona(event.target.value)}>
        <option value="">Select a persona</option>
        {controls.personas.map(persona => <option key={persona.id} value={persona.id}>{persona.name} ({persona.role})</option>)}
      </select>{" "}
      <button disabled={pending} type="submit">Sign in</button>
      {pending && <p role="status">Signing in…</p>}
      {error && <p id="signin-error" role="alert">{error}</p>}
      {retry && <button type="button" disabled={pending} onClick={() => void submit()}>Retry</button>}
    </form>
  </>;
}

function SamplePanel() {
  const { services } = useServices();
  const [result, setResult] = useState<Result<SampleRecord[]> | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void services.sampleRecords().then(value => { if (active) setResult(value); });
    return () => { active = false; };
  }, [services, attempt]);
  return <section aria-label="Mock service status">
    <h2>Mock service status</h2>
    <p>Synthetic demonstration records only; these are not customer lists or workload calculations.</p>
    {!result ? <p role="status">Loading sample records…</p> : !result.ok ? <>
      <p role="alert">{result.error.message}</p>
      <button onClick={() => { setResult(null); setAttempt(attempt + 1); }}>Retry</button>
    </> : result.data.length === 0 ? <p>No sample records.</p> : <ul>{result.data.map(record => <li key={record.id}>{record.label}</li>)}</ul>}
  </section>;
}

function Dashboard() {
  const { services, controls, user } = useServices();
  const snapshot = useSyncExternalStore(controls.subscribe, controls.getSnapshot, controls.getSnapshot);
  const [result, setResult] = useState<Result<WorkloadData> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const refresh = () => { setResult(null); setAttempt(value => value + 1); };
  useEffect(() => {
    let active = true;
    void services.workload().then(value => { if (active) setResult(value); });
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => { active = false; window.removeEventListener("focus", onFocus); };
  }, [services, user?.id, snapshot.revision, attempt]);
  useEffect(() => {
    if (!result?.ok) return;
    const delay = Math.max(1000, Date.parse(`${result.data.today}T24:00:00.000Z`) - Date.parse(result.data.asOf));
    const timer = window.setTimeout(refresh, delay);
    return () => window.clearTimeout(timer);
  }, [result]);
  if (!result) return <p role="status">Loading workload…</p>;
  if (!result.ok) return <><p role="alert">{result.error.message}</p><button onClick={refresh}>Retry</button></>;
  const assigned = result.data.customers.filter(customer => customer.workloadBucket);
  return <><section aria-label="Sales workload"><p>UTC date: {result.data.today}</p>{assigned.length === 0 && <p>No open assigned customers need work.</p>}<div className="workload">{workloadBuckets.map(bucket => <Link key={bucket} href={`/customers/mine?status=open&bucket=${bucket}`}><b>{bucketLabels[bucket]}</b><span>{result.data.counts[bucket]}</span></Link>)}</div><p>Never contacted uses imported contact history separately from recorded application activity; attempts alone remain never contacted.</p></section><SamplePanel key={`${user?.id}:${snapshot.revision}`} /></>;
}

function AdminSettings({ reasons }: { reasons: boolean }) {
  const { services, controls } = useServices(); const [users, setUsers] = useState<Result<User[]> | null>(null); const [items, setItems] = useState<Result<ClosureReason[]> | null>(null); const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [role, setRole] = useState<"Admin" | "Sales">("Sales"); const [error, setError] = useState("");
  const snapshot = useSyncExternalStore(controls.subscribe, controls.getSnapshot, controls.getSnapshot); const load = () => { if (reasons) void services.closureReasons().then(setItems); else void services.listUsers().then(setUsers); }; useEffect(load, [services, reasons, snapshot.revision]);
  async function add(event: FormEvent) { event.preventDefault(); setError(""); const result = reasons ? await services.createClosureReason(name) : await services.createUser({ name, email, role }); if (!result.ok) { setError(result.error.message); return; } setName(""); setEmail(""); load(); }
  async function toggle(item: User | ClosureReason) { const result = reasons ? await services.updateClosureReason(item.id, { active: !(item as ClosureReason).active }) : await services.updateUser(item.id, { active: !(item as User).active }); if (!result.ok) setError(result.error.message); else load(); }
  async function rename(item: User | ClosureReason) { const value = window.prompt("New name", reasons ? (item as ClosureReason).label : (item as User).name); if (value === null) return; const result = reasons ? await services.updateClosureReason(item.id, { label: value }) : await services.updateUser(item.id, { name: value }); if (!result.ok) setError(result.error.message); else load(); }
  const list = reasons ? items : users; if (!list) return <><p>Placeholder — settings are synthetic.</p><p role="status">Loading settings…</p></>; if (!list.ok) return <p role="alert">{list.error.message}</p>;
  return <section aria-label={reasons ? "Closure reason settings" : "User settings"}><p>Placeholder — settings are synthetic.</p><form onSubmit={add}><label>Name <input value={name} onChange={e => setName(e.target.value)} /></label>{!reasons && <><label>Email <input type="email" value={email} onChange={e => setEmail(e.target.value)} /></label><label>Role <select value={role} onChange={e => setRole(e.target.value as "Admin" | "Sales")}><option>Sales</option><option>Admin</option></select></label></>}<button type="submit">Create</button></form>{error && <p role="alert">{error}</p>}<ul>{list.data.map(item => <li key={item.id}>{reasons ? `${(item as ClosureReason).label} · ${(item as ClosureReason).active ? "Active" : "Inactive"}` : `${(item as User).name} · ${(item as User).email} · ${(item as User).role} · ${(item as User).active === false ? "Inactive" : "Active"}`}<button type="button" onClick={() => void rename(item)}>Rename</button><button type="button" onClick={() => void toggle(item)}>{reasons ? ((item as ClosureReason).active ? "Deactivate" : "Reactivate") : ((item as User).active === false ? "Activate" : "Deactivate")}</button></li>)}</ul></section>;
}
function ImportView() { const { services } = useServices(); const [result, setResult] = useState<Result<ImportResult> | null>(null); const [error, setError] = useState(""); const [pending, setPending] = useState(false); async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const file = event.currentTarget.elements.namedItem("workbook") as HTMLInputElement; const selected = file.files?.[0]; setError(""); if (!selected) { setError("Choose an .xlsx workbook."); return; } if (!selected.name.toLowerCase().endsWith(".xlsx")) { setError("Choose an .xlsx workbook."); return; } if (selected.size > 10_485_760) { setError("Workbook must be 10 MiB or smaller."); return; } if (pending) return; setPending(true); const value = await services.importWorkbook({ name: selected.name, size: selected.size, submissionId: "import-demo" }); setPending(false); if (!value.ok) setError(value.error.message); else setResult(value); } return <section aria-label="Excel import"><p>Placeholder — workbook parsing is simulated.</p><p>Simulated workbook parsing; maximum 10 MiB, .xlsx only.</p><form onSubmit={submit}><input name="workbook" type="file" accept=".xlsx" /><button type="submit" disabled={pending}>{pending ? "Uploading…" : "Upload"}</button></form>{error && <p role="alert">{error}</p>}{result?.ok && <><h2>Import job {result.data.jobId}</h2><p>{result.data.filename} · {result.data.status} · completed {result.data.completedAt} UTC</p><p>Processed {result.data.processed}; created {result.data.created}; updated {result.data.updated}; error rows {result.data.errorRows}</p>{result.data.errors.length > 0 && <ul>{result.data.errors.map(item => <li key={`${item.row}-${item.field}`}>Row {item.row}, {item.field}: {item.reason}</li>)}</ul>}<Link href="/customers">View All Customers</Link></>}</section>; }

const dash = (value: unknown) => value === null || value === undefined || value === "" ? "—" : String(value);
const submissionId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random()}`;
function Customers({ mine }: { mine: boolean }) {
  const { services, user } = useServices();
  const [result, setResult] = useState<Result<Customer[]> | null>(null);
  const initialParams = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const [workload, setWorkload] = useState<Result<WorkloadData> | null>(null);
  const [query, setQuery] = useState(() => initialParams.get("q") ?? ""); const [status, setStatus] = useState(() => ["all", "open", "closed"].includes(initialParams.get("status") ?? "") ? initialParams.get("status")! : (mine ? "open" : "all")); const [owner, setOwner] = useState(() => initialParams.get("owner") ?? "all"); const [contacted, setContacted] = useState(() => initialParams.get("contacted") ?? "all"); const [recent, setRecent] = useState(() => initialParams.get("recent") ?? "all"); const [tier, setTier] = useState(() => initialParams.get("tier") ?? "all"); const [bucket, setBucket] = useState<WorkloadBucket | "all">(() => workloadBuckets.includes(initialParams.get("bucket") as WorkloadBucket) ? initialParams.get("bucket") as WorkloadBucket : "all"); const [sort, setSort] = useState<"priority" | "bcn" | "name" | "propensityRank" | "propensityScore">(() => (["bcn", "name", "propensityRank", "propensityScore"] as const).includes(initialParams.get("sort") as never) ? initialParams.get("sort") as "bcn" : (mine ? "priority" : "bcn")); const [descending, setDescending] = useState(() => initialParams.get("dir") === "desc"); const [page, setPage] = useState(() => Math.max(1, Number(initialParams.get("page") ?? 1) || 1)); const [pageSize, setPageSize] = useState(() => [10, 25, 50, 100].includes(Number(initialParams.get("size"))) ? Number(initialParams.get("size")) : 25);
  useEffect(() => { let active = true; void services.listCustomers().then(value => { if (active) setResult(value); }); if (mine) void services.workload().then(value => { if (active) setWorkload(value); }); return () => { active = false; }; }, [services, mine]);
  const firstUrl = useRef(true);
  useEffect(() => { const sync = () => { const params = new URLSearchParams(window.location.search); setQuery(params.get("q") ?? ""); setStatus(["all", "open", "closed"].includes(params.get("status") ?? "") ? params.get("status")! : (mine ? "open" : "all")); setOwner(params.get("owner") ?? "all"); setContacted(params.get("contacted") ?? "all"); setRecent(params.get("recent") ?? "all"); setTier(params.get("tier") ?? "all"); setBucket(workloadBuckets.includes(params.get("bucket") as WorkloadBucket) ? params.get("bucket") as WorkloadBucket : "all"); setSort((["bcn", "name", "propensityRank", "propensityScore"] as const).includes(params.get("sort") as never) ? params.get("sort") as "bcn" : (mine ? "priority" : "bcn")); setDescending(params.get("dir") === "desc"); setPage(Math.max(1, Number(params.get("page") ?? 1) || 1)); setPageSize([10, 25, 50, 100].includes(Number(params.get("size"))) ? Number(params.get("size")) : 25); }; window.addEventListener("popstate", sync); return () => window.removeEventListener("popstate", sync); }, [mine]);
  useEffect(() => { const params = new URLSearchParams(); if (query) params.set("q", query); if (status !== "all") params.set("status", status); if (!mine && owner !== "all") params.set("owner", owner); if (mine && bucket !== "all") params.set("bucket", bucket); if (contacted !== "all") params.set("contacted", contacted); if (recent !== "all") params.set("recent", recent); if (tier !== "all") params.set("tier", tier); if (sort !== "priority") params.set("sort", sort); if (descending) params.set("dir", "desc"); if (page !== 1) params.set("page", String(page)); if (pageSize !== 25) params.set("size", String(pageSize)); const suffix = params.toString(); if (firstUrl.current) { firstUrl.current = false; window.history.replaceState(null, "", `${window.location.pathname}${suffix ? `?${suffix}` : ""}`); } else window.history.pushState(null, "", `${window.location.pathname}${suffix ? `?${suffix}` : ""}`); }, [query, status, owner, bucket, contacted, recent, tier, sort, descending, page, pageSize, mine]);
  if (!result || (mine && !workload)) return <p role="status">Loading customers…</p>;
  if (!result.ok || (mine && workload && !workload.ok)) { const error = !result.ok ? result.error : (workload as { ok: false; error: { message: string } }).error; return <><p role="alert">{error.message}</p><button onClick={() => { setResult(null); setWorkload(null); void services.listCustomers().then(setResult); if (mine) void services.workload().then(setWorkload); }}>Retry</button></>; }
  const needle = query.trim().toLowerCase().replace(/[\s()\-]/g, "");
  const owners = [...new Map(result.data.filter(c => c.ownerId).map(c => [c.ownerId, c.ownerName])).entries()];
  const validOwner = owner === "all" || owner === "unassigned" || owners.some(([id]) => id === owner); const validBool = (value: string) => value === "all" || value === "true" || value === "false"; const validTier = tier === "all" || tier === "A" || tier === "B";
  const workloadRows = mine && workload?.ok ? workload.data.customers : [];
  const rows: (Customer | WorkloadCustomer)[] = mine ? workloadRows : result.data;
  const priority = (a: WorkloadCustomer, b: WorkloadCustomer) => { const bucketResult = (a.workloadBucket ? workloadBuckets.indexOf(a.workloadBucket) : workloadBuckets.length) - (b.workloadBucket ? workloadBuckets.indexOf(b.workloadBucket) : workloadBuckets.length); if (bucketResult) return bucketResult; const due = (a.relevantDue ?? "").localeCompare(b.relevantDue ?? ""); if (due) return due; const rank = (a.propensityRank == null ? Infinity : a.propensityRank) - (b.propensityRank == null ? Infinity : b.propensityRank); if (rank) return rank; const score = (b.propensityScore == null ? -Infinity : b.propensityScore) - (a.propensityScore == null ? -Infinity : a.propensityScore); return score || a.bcn.localeCompare(b.bcn); };
  const records = rows.filter(c => (!mine || c.ownerId === user?.id) && (!needle || [c.name, c.bcn, c.mbcn, ...c.phones].join(" ").toLowerCase().replace(/[\s()\-]/g, "").includes(needle)) && (status === "all" || c.status.toLowerCase() === status) && (mine || !validOwner || owner === "all" || (owner === "unassigned" ? !c.ownerId : c.ownerId === owner)) && (!mine || bucket === "all" || (c as WorkloadCustomer).workloadBucket === bucket) && (!validBool(contacted) || contacted === "all" || String(c.previouslyContacted) === contacted) && (!validBool(recent) || recent === "all" || String(c.recent) === recent) && (!validTier || tier === "all" || c.propensityTier === tier)).sort((a, b) => { if (mine && sort === "priority") return priority(a as WorkloadCustomer, b as WorkloadCustomer); if (!mine && sort === "bcn") { const lifecycle = Number(b.status === "Open") - Number(a.status === "Open"); if (lifecycle) return lifecycle; const rank = (a.propensityRank == null ? Infinity : a.propensityRank) - (b.propensityRank == null ? Infinity : b.propensityRank); if (rank) return rank; const score = (b.propensityScore == null ? -Infinity : b.propensityScore) - (a.propensityScore == null ? -Infinity : a.propensityScore); if (score) return score; return a.bcn.localeCompare(b.bcn); } const av = a[sort as keyof Customer], bv = b[sort as keyof Customer]; if (av == null && bv == null) return a.bcn.localeCompare(b.bcn); if (av == null) return 1; if (bv == null) return -1; const value = String(av).localeCompare(String(bv), undefined, { numeric: true }); return (descending ? -value : value) || a.bcn.localeCompare(b.bcn); });
  const pages = Math.max(1, Math.ceil(records.length / pageSize)); const current = Math.min(page, pages); const shown = records.slice((current - 1) * pageSize, current * pageSize); const change = (fn: () => void) => { fn(); setPage(1); };
  const listQuery = typeof window === "undefined" ? "" : window.location.search;
  return <><section aria-label="Customer list"><div className="filters"><label>Search <input value={query} onChange={e => change(() => setQuery(e.target.value))} placeholder="Name, BCN, MBCN, phone" /></label> <label>Status <select value={status} onChange={e => change(() => setStatus(e.target.value))}><option value="all">All</option><option value="open">Open</option><option value="closed">Closed</option></select></label>{mine && <label>Bucket <select value={bucket} onChange={e => change(() => setBucket(e.target.value as WorkloadBucket | "all"))}><option value="all">All buckets</option>{workloadBuckets.map(value => <option key={value} value={value}>{bucketLabels[value]}</option>)}</select></label>}{!mine && <label>Owner <select value={owner} onChange={e => change(() => setOwner(e.target.value))}><option value="all">All owners</option><option value="unassigned">Unassigned</option>{owners.map(([id, name]) => <option key={id!} value={id!}>{name}</option>)}</select></label>}<label>Imported contacted <select value={contacted} onChange={e => change(() => setContacted(e.target.value))}><option value="all">All</option><option value="true">Yes</option><option value="false">No</option></select></label><label>Recent <select value={recent} onChange={e => change(() => setRecent(e.target.value))}><option value="all">All</option><option value="true">Yes</option><option value="false">No</option></select></label><label>Tier <select value={tier} onChange={e => change(() => setTier(e.target.value))}><option value="all">All tiers</option><option value="A">A</option><option value="B">B</option></select></label><label>Rows <select value={pageSize} onChange={e => change(() => setPageSize(Number(e.target.value)))}><option>10</option><option>25</option><option>50</option><option>100</option></select></label></div><p>{records.length} customers</p><table><caption>{mine ? "My Customers" : "All Customers"}</caption><thead><tr>{(["name", "bcn", "propensityRank", "propensityScore"] as const).map(key => <th key={key}><button onClick={() => { setSort(key); setDescending(sort === key ? !descending : false); setPage(1); }}>{key === "bcn" ? "BCN" : key === "propensityRank" ? "Rank" : key === "propensityScore" ? "Score" : "Name"}</button></th>)}<th>Owner</th><th>Status</th><th>Contact</th><th>Next follow-up</th></tr></thead><tbody>{shown.map(c => <tr key={c.bcn}><td><Link href={`/customers/${c.bcn}${listQuery}`}>{c.name}</Link></td><td>{c.bcn}</td><td>{dash(c.propensityRank)}</td><td>{dash(c.propensityScore)}</td><td>{c.ownerName ?? "Unassigned"}</td><td>{c.status}</td><td>{c.contactStatus}</td><td>{dash(c.nextFollowUp)}</td></tr>)}</tbody></table><p><button disabled={current === 1} onClick={() => setPage(current - 1)}>Previous</button> Page {current} of {pages} <button disabled={current === pages} onClick={() => setPage(current + 1)}>Next</button></p></section><SamplePanel /></>;
}
function SourceGroups({ source }: { source: CustomerDetail["source"] }) {
  const groups = [["Identity", ["bcn", "MBCN", "customer_name", "phone"]], ["Prioritization", ["previously_contacted", "propensity_score", "propensity_tier", "propensity_rank", "recent"]], ["Sales organization", ["Inside_Lead", "Field_Rep", "SC_Naming", "Inside_Rep", "Branch_Code", "RSM_Name", "Originating_BU"]], ["Purchase and revenue", ["LAST_PURCHASE_DATE", "REVENUE_AMOUNT_2024", "REVENUE_AMOUNT_2025", "REVENUE_AMOUNT_2026"]], ["FEM revenue", ["FEM_AMOUNT_2024", "FEM_AMOUNT_2025", "FEM_AMOUNT_2026"]], ["Commercial", ["Payment_Terms"]], ["Vendor performance", ["vendor_1", "vendor_1_revenue", "vendor_2", "vendor_2_revenue", "vendor_3", "vendor_3_revenue"]], ["Category performance", ["category_1", "category_1_revenue", "category_2", "category_2_revenue", "category_3", "category_3_revenue"]]] as const;
  return <>{groups.map(([name, keys]) => <section key={name}><h3>{name}</h3><dl>{keys.map(key => <div key={key}><dt>{key}</dt><dd>{dash(source[key])}</dd></div>)}</dl></section>)}</>;
}
function CustomerDetailView({ bcn }: { bcn: string }) {
  const { services, user } = useServices(); const [result, setResult] = useState<Result<CustomerDetail> | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [outcome, setOutcome] = useState<"Attempt" | "Contact">("Attempt"); const [interactionNote, setInteractionNote] = useState(""); const [note, setNote] = useState("");
  const [followUpType, setFollowUpType] = useState<FollowUpType | "">(""); const [followUpDue, setFollowUpDue] = useState(""); const [followUpDueKind, setFollowUpDueKind] = useState<"date" | "datetime" | "none">("none"); const [followUpNote, setFollowUpNote] = useState("");
  const [editId, setEditId] = useState<string | null>(null); const [completionId, setCompletionId] = useState<string | null>(null); const [completionOutcome, setCompletionOutcome] = useState<"Attempt" | "Contact">("Contact"); const [completionNote, setCompletionNote] = useState("");
  const [closureReason, setClosureReason] = useState("");
  const [pending, setPending] = useState<"interaction" | "note" | string | null>(null); const [error, setError] = useState("");
  const submission = useRef<string | null>(null);
  const load = () => void services.getCustomer(bcn).then(value => { setResult(value); setHistoryPage(1); });
  useEffect(() => { let active = true; void services.getCustomer(bcn).then(value => { if (active) setResult(value); }); return () => { active = false; }; }, [services, bcn]);
  if (!result) return <p role="status">Loading customer…</p>; if (!result.ok) return <><h1>Customer not found</h1><p role="alert">{result.error.message}</p><Link href="/customers">Back to customers</Link></>;
  const c = result.data; const readOnly = user?.role === "Sales" && c.ownerId !== user.id;
  const historyPages = Math.max(1, Math.ceil(c.histories.length / 10)); const history = c.histories.slice((historyPage - 1) * 10, historyPage * 10);
  const canEdit = !readOnly && c.status === "Open"; const canDelete = !readOnly;
  const followUpInput = () => followUpType ? { type: followUpType, due: followUpDue || null, dueKind: followUpDueKind, note: followUpNote } : null;
  async function createInteraction() { if (pending) return; submission.current ??= `intent-${Date.now()}-${Math.random()}`; setPending("interaction"); setError(""); const value = await services.createInteraction({ bcn, outcome, note: interactionNote, followUp: followUpInput(), submissionId: submission.current }); setPending(null); if (!value.ok) { setError(value.error.message); return; } submission.current = null; setInteractionNote(""); setFollowUpType(""); setFollowUpDue(""); setFollowUpNote(""); load(); }
  async function createNote() { if (pending) return; submission.current ??= `intent-${Date.now()}-${Math.random()}`; setPending("note"); setError(""); const value = await services.createNote({ bcn, text: note, submissionId: submission.current }); setPending(null); if (!value.ok) { setError(value.error.message); return; } submission.current = null; setNote(""); load(); }
  async function createFollowUp() { if (pending || !followUpType) return; setPending("follow-up"); setError(""); const value = await services.createFollowUp({ bcn, type: followUpType, due: followUpDue || null, dueKind: followUpDueKind, note: followUpNote, submissionId: submissionId("follow-up") }); setPending(null); if (!value.ok) { setError(value.error.message); return; } setFollowUpType(""); setFollowUpDue(""); setFollowUpNote(""); load(); }
  function startEdit(item: typeof c.followUps[number]) { setEditId(item.id); setFollowUpType(item.type); setFollowUpDue(item.due ?? ""); setFollowUpDueKind(item.dueKind); setFollowUpNote(item.note ?? ""); }
  async function saveEdit(item: typeof c.followUps[number]) { if (pending || !followUpType) return; setPending(item.id); setError(""); const value = await services.updateFollowUp({ bcn, followUpId: item.id, type: followUpType, due: followUpDue || null, dueKind: followUpDueKind, note: followUpNote, expectedUpdatedAt: item.updatedAt, submissionId: submissionId("edit") }); setPending(null); if (!value.ok) setError(value.error.message); else { setEditId(null); setFollowUpType(""); setFollowUpDue(""); setFollowUpNote(""); load(); } }
  async function cancel(item: typeof c.followUps[number]) { if (pending || !window.confirm(`Cancel ${item.type} ${item.id}?`)) return; setPending(item.id); setError(""); const value = await services.cancelFollowUp(bcn, item.id, submissionId("cancel")); setPending(null); if (!value.ok) setError(value.error.message); else load(); }
  async function complete(item: typeof c.followUps[number]) { if (pending) return; setPending(item.id); const value = await services.completeFollowUp({ bcn, followUpId: item.id, outcome: completionOutcome, note: completionNote, submissionId: submissionId("complete") }); setPending(null); if (!value.ok) setError(value.error.message); else { setCompletionId(null); setCompletionNote(""); load(); } }
  async function close() { if (pending || !closureReason || !window.confirm(`Close ${c.name}? ${c.followUps.filter(item => item.status === "Open").length} open follow-up(s) will be cancelled.`)) return; setPending("close"); const value = await services.closeCustomer({ bcn, reasonId: closureReason, expectedStatus: "Open", submissionId: submissionId("close") }); setPending(null); if (!value.ok) setError(value.error.message); else load(); }
  async function reopen() { if (pending) return; setPending("reopen"); const value = await services.reopenCustomer({ bcn, submissionId: submissionId("reopen") }); setPending(null); if (!value.ok) setError(value.error.message); else load(); }
  async function remove(item: typeof c.histories[number]) { if (pending || !window.confirm(`Delete ${item.kind} ${item.id} for ${c.name}?`)) return; setPending(item.id); setError(""); const value = await services.deleteHistory(bcn, item.id); setPending(null); if (!value.ok) { setError(value.error.message); return; } load(); }
  const listQuery = typeof window === "undefined" ? "" : window.location.search;
  return <><Link href={`/customers${listQuery}`}>← Back to customers</Link><h1>{c.name}</h1><p><b>BCN:</b> {c.bcn} · <b>Owner:</b> {c.ownerName ?? "Unassigned"} · <b>Status:</b> {c.status}</p><p><b>Contact status:</b> {c.contactStatus} · <b>Next action:</b> {dash(c.nextFollowUp)} (UTC)</p><p>{readOnly ? "Read-only for your role." : user?.role === "Admin" ? "Admin can manage this customer." : "You can work on this customer."}</p>
    <section aria-label="Record interactions"><h2>Record interaction</h2>{c.status === "Closed" && <p>Reopen this customer before creating an interaction or note.</p>}<form onSubmit={event => { event.preventDefault(); void createInteraction(); }}><label>Outcome <select value={outcome} disabled={!canEdit || pending !== null} onChange={event => setOutcome(event.target.value as "Attempt" | "Contact")}><option>Attempt</option><option>Contact</option></select></label> <label>Interaction note <textarea value={interactionNote} maxLength={4000} disabled={!canEdit || pending !== null} onChange={event => setInteractionNote(event.target.value)} /></label> <label>Follow-up <select value={followUpType} disabled={!canEdit || pending !== null} onChange={event => setFollowUpType(event.target.value as FollowUpType | "")}><option value="">None</option><option>Appointment</option><option>Reminder</option><option>Follow-up needed</option></select></label>{followUpType && <><label>Follow-up due kind <select value={followUpDueKind} disabled={!canEdit || pending !== null} onChange={event => setFollowUpDueKind(event.target.value as "date" | "datetime" | "none")}><option value="none">No date</option><option value="date">Date only</option><option value="datetime">Date and time UTC</option></select></label><label>Follow-up due UTC <input value={followUpDue} disabled={followUpDueKind === "none" || !canEdit || pending !== null} onChange={event => setFollowUpDue(event.target.value)} /></label><label>Follow-up note <textarea maxLength={4000} value={followUpNote} disabled={!canEdit || pending !== null} onChange={event => setFollowUpNote(event.target.value)} /></label></>}<button type="submit" disabled={!canEdit || pending !== null}>Save interaction</button></form><form onSubmit={event => { event.preventDefault(); void createNote(); }}><label>Standalone note <textarea value={note} maxLength={4000} disabled={!canEdit || pending !== null} onChange={event => setNote(event.target.value)} /></label> <button type="submit" disabled={!canEdit || pending !== null}>Save note</button></form>{error && <p role="alert">{error}</p>}</section>
    <section aria-label="Follow-ups"><h2>Follow-ups (UTC)</h2><form onSubmit={event => { event.preventDefault(); void createFollowUp(); }}><label>Type <select value={followUpType} disabled={!canEdit || pending !== null} onChange={event => setFollowUpType(event.target.value as FollowUpType | "")}><option value="">Choose type</option><option>Appointment</option><option>Reminder</option><option>Follow-up needed</option></select></label> <label>Due <input aria-label="Due UTC" value={followUpDue} disabled={!canEdit || pending !== null || followUpDueKind === "none"} placeholder="YYYY-MM-DD or YYYY-MM-DDTHH:mmZ" onChange={event => setFollowUpDue(event.target.value)} /></label> <label>Due kind <select value={followUpDueKind} disabled={!canEdit || pending !== null} onChange={event => setFollowUpDueKind(event.target.value as "date" | "datetime" | "none")}><option value="none">No date</option><option value="date">Date only</option><option value="datetime">Date and time</option></select></label> <label>Follow-up note <textarea maxLength={4000} value={followUpNote} disabled={!canEdit || pending !== null} onChange={event => setFollowUpNote(event.target.value)} /></label> <button type="submit" disabled={!canEdit || pending !== null || !followUpType}>Add follow-up</button></form><ul>{c.followUps.map(item => <li key={item.id}>{editId === item.id ? <form onSubmit={event => { event.preventDefault(); void saveEdit(item); }}><select aria-label={`Edit ${item.id} type`} value={followUpType} onChange={event => setFollowUpType(event.target.value as FollowUpType)}><option>Appointment</option><option>Reminder</option><option>Follow-up needed</option></select><select aria-label={`Edit ${item.id} due kind`} value={followUpDueKind} onChange={event => setFollowUpDueKind(event.target.value as "date" | "datetime" | "none")}><option value="none">No date</option><option value="date">Date only</option><option value="datetime">Date and time UTC</option></select><input aria-label={`Edit ${item.id} due`} value={followUpDue} disabled={followUpDueKind === "none"} onChange={event => setFollowUpDue(event.target.value)} /><textarea aria-label={`Edit ${item.id} note`} value={followUpNote} onChange={event => setFollowUpNote(event.target.value)} /><button type="submit">Save edit</button><button type="button" onClick={() => setEditId(null)}>Cancel edit</button></form> : <>{item.type} · {item.due ?? "Undated"} UTC · {item.status} · {item.note ?? ""}{canEdit && item.status === "Open" && <><button type="button" onClick={() => startEdit(item)} disabled={pending !== null}>Edit</button><button type="button" onClick={() => void cancel(item)} disabled={pending !== null}>Cancel</button><button type="button" onClick={() => setCompletionId(item.id)} disabled={pending !== null}>Complete</button>{completionId === item.id && <form onSubmit={event => { event.preventDefault(); void complete(item); }}><label>Completion outcome <select value={completionOutcome} onChange={event => setCompletionOutcome(event.target.value as "Attempt" | "Contact")}><option>Attempt</option><option>Contact</option></select></label><label>Completion note <textarea value={completionNote} maxLength={4000} onChange={event => setCompletionNote(event.target.value)} /></label><button type="submit">Save completion</button></form>}</>}</>}</li>)}</ul></section>
    <section aria-label="Customer lifecycle"><h2>Customer lifecycle</h2>{c.status === "Closed" ? <><p>Closed for {c.closure?.reason ?? "unknown reason"} by {c.closure?.actor ?? "unknown actor"} at {c.closure?.timestamp ?? "unknown time"} UTC.</p><button type="button" onClick={() => void reopen()} disabled={readOnly || pending !== null}>Reopen customer</button></> : <><label>Closure reason <select value={closureReason} onChange={event => setClosureReason(event.target.value)}><option value="">Choose reason</option>{["Won", "Lost", "No longer a fit", "Duplicate", "Unreachable", "Out of territory", "Other"].map(reason => <option key={reason} value={`closure-${["Won", "Lost", "No longer a fit", "Duplicate", "Unreachable", "Out of territory", "Other"].indexOf(reason) + 1}`}>{reason}</option>)}</select></label> <button type="button" onClick={() => void close()} disabled={readOnly || pending !== null || !closureReason}>Close customer</button></>}</section>
    <h2>Imported customer source information</h2><SourceGroups source={c.source} /><h2>Phones</h2><ul>{c.phones.length ? c.phones.map(phone => <li key={phone}>{phone}</li>) : <li>—</li>}</ul><h2>History</h2><p>{c.histories.length} records</p><ul>{history.map(item => <li key={item.id}>{item.deleted ? `${item.timestamp} · ${item.deletedBy} · Deleted ${item.kind} (recorded ${item.deletedAt})` : <>{item.timestamp} · {item.actor} · {item.kind}: {item.text}{item.outcome ? ` (${item.outcome})` : ""}{item.interactionId ? ` (interaction ${item.interactionId})` : ""}</>}{canDelete && !item.deleted && (item.kind === "Interaction" || item.kind === "Standalone note") && <button type="button" onClick={() => void remove(item)} disabled={pending !== null}>Delete</button>}</li>)}</ul><p><button disabled={historyPage === 1} onClick={() => setHistoryPage(historyPage - 1)}>Previous history</button> Page {historyPage} of {historyPages} <button disabled={historyPage === historyPages} onClick={() => setHistoryPage(historyPage + 1)}>Next history</button></p><SamplePanel /></>;
}

export default function Home() {
  const { services, controls, user } = useServices();
  const pathname = usePathname();
  const router = useRouter();
  const snapshot = useSyncExternalStore(controls.subscribe, controls.getSnapshot, controls.getSnapshot);
  const route = routes.find(([path]) => path === pathname);
  const detailBcn = pathname.startsWith("/customers/") && pathname !== "/customers/mine" ? pathname.slice("/customers/".length) : null;
  const customerRoute = pathname === "/customers" || pathname === "/customers/mine";
  const login = pathname === "/login" || pathname === "/";
  const redirect = login && user ? landing(user) : (login && pathname === "/") || ((route || customerRoute || detailBcn) && !user) ? "/login" : null;
  useEffect(() => { if (redirect) router.replace(redirect); }, [redirect, router]);

  return <main>
    <MockPanel />
    {snapshot.notice && <p role="alert">{snapshot.notice}</p>}
    {redirect ? <p role="status">Returning to {user ? "your workspace" : "sign-in"}…</p> : login ? <SignIn key={snapshot.notice + snapshot.reset} /> : !route && !customerRoute && !detailBcn ? <>
      <h1>Page not found</h1><Link href={user ? landing(user) : "/login"}>Return to {user ? "your workspace" : "sign-in"}</Link>
    </> : user && <>
      <header><p>{user.name} · {user.role}</p><button onClick={() => void services.signOut()}>Log out</button></header>
      <nav aria-label="Main navigation">{routes.filter(([, , role]) => role === "Both" || role === user.role).map(([path, title]) => <Link key={path} href={path} aria-current={path === pathname ? "page" : undefined}>{title}</Link>)}</nav>
      {detailBcn ? <CustomerDetailView bcn={detailBcn} /> : customerRoute ? <><h1>{pathname === "/customers/mine" ? "My Customers" : "All Customers"}</h1><Customers mine={pathname === "/customers/mine"} /></> : route![0] === "/dashboard" ? <><h1>Dashboard</h1><Dashboard /></> : route![2] === "Admin" && user.role !== "Admin" ? <><h1>Access denied</h1><p>This page requires the Admin role.</p><Link href="/dashboard">Back to Dashboard</Link></> : <>
        <h1>{route![1]}</h1>{pathname === "/admin/users" ? <AdminSettings reasons={false} /> : pathname === "/admin/closure-reasons" ? <AdminSettings reasons /> : pathname === "/admin/import" ? <ImportView /> : <p>Placeholder — this functionality is not implemented yet.</p>}
        <SamplePanel key={`${user.id}:${pathname}:${snapshot.revision}`} />
      </>}
    </>}
  </main>;
}
