"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Typography } from "antd";
import { useServices } from "../../services/provider";
import type { Customer, CustomerDetail, Result, SampleRecord, Scenario, User } from "../../services/types";

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

const dash = (value: unknown) => value === null || value === undefined || value === "" ? "—" : String(value);
function Customers({ mine }: { mine: boolean }) {
  const { services, user } = useServices();
  const [result, setResult] = useState<Result<Customer[]> | null>(null);
  const [query, setQuery] = useState(""); const [status, setStatus] = useState("all"); const [owner, setOwner] = useState("all"); const [contacted, setContacted] = useState("all"); const [recent, setRecent] = useState("all"); const [tier, setTier] = useState("all"); const [sort, setSort] = useState<"bcn" | "name" | "propensityRank" | "propensityScore">("bcn"); const [descending, setDescending] = useState(false); const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(25);
  useEffect(() => { let active = true; void services.listCustomers().then(value => { if (active) setResult(value); }); return () => { active = false; }; }, [services]);
  if (!result) return <p role="status">Loading customers…</p>;
  if (!result.ok) return <><p role="alert">{result.error.message}</p><button onClick={() => { setResult(null); void services.listCustomers().then(setResult); }}>Retry</button></>;
  const needle = query.trim().toLowerCase().replace(/[\s()\-]/g, "");
  const owners = [...new Map(result.data.filter(c => c.ownerId).map(c => [c.ownerId, c.ownerName])).entries()];
  const records = result.data.filter(c => (!mine || c.ownerId === user?.id) && (!needle || [c.name, c.bcn, c.mbcn, ...c.phones].join(" ").toLowerCase().replace(/[\s()\-]/g, "").includes(needle)) && (status === "all" || c.status.toLowerCase() === status) && (mine || owner === "all" || (owner === "unassigned" ? !c.ownerId : c.ownerId === owner)) && (contacted === "all" || String(c.previouslyContacted) === contacted) && (recent === "all" || String(c.recent) === recent) && (tier === "all" || c.propensityTier === tier)).sort((a, b) => { const av = a[sort] ?? Infinity, bv = b[sort] ?? Infinity; return (descending ? -1 : 1) * (String(av).localeCompare(String(bv), undefined, { numeric: true }) || a.bcn.localeCompare(b.bcn)); });
  const pages = Math.max(1, Math.ceil(records.length / pageSize)); const current = Math.min(page, pages); const shown = records.slice((current - 1) * pageSize, current * pageSize); const change = (fn: () => void) => { fn(); setPage(1); };
  return <><section aria-label="Customer list"><div className="filters"><label>Search <input value={query} onChange={e => change(() => setQuery(e.target.value))} placeholder="Name, BCN, MBCN, phone" /></label> <label>Status <select value={status} onChange={e => change(() => setStatus(e.target.value))}><option value="all">All</option><option value="open">Open</option><option value="closed">Closed</option></select></label>{!mine && <label>Owner <select value={owner} onChange={e => change(() => setOwner(e.target.value))}><option value="all">All owners</option><option value="unassigned">Unassigned</option>{owners.map(([id, name]) => <option key={id!} value={id!}>{name}</option>)}</select></label>}<label>Imported contacted <select value={contacted} onChange={e => change(() => setContacted(e.target.value))}><option value="all">All</option><option value="true">Yes</option><option value="false">No</option></select></label><label>Recent <select value={recent} onChange={e => change(() => setRecent(e.target.value))}><option value="all">All</option><option value="true">Yes</option><option value="false">No</option></select></label><label>Tier <select value={tier} onChange={e => change(() => setTier(e.target.value))}><option value="all">All tiers</option><option value="A">A</option><option value="B">B</option></select></label><label>Rows <select value={pageSize} onChange={e => change(() => setPageSize(Number(e.target.value)))}><option>10</option><option>25</option><option>50</option><option>100</option></select></label></div><p>{records.length} customers</p><table><caption>{mine ? "My Customers" : "All Customers"}</caption><thead><tr>{(["name", "bcn", "propensityRank", "propensityScore"] as const).map(key => <th key={key}><button onClick={() => { setSort(key); setDescending(sort === key ? !descending : false); setPage(1); }}>{key === "bcn" ? "BCN" : key === "propensityRank" ? "Rank" : key === "propensityScore" ? "Score" : "Name"}</button></th>)}<th>Owner</th><th>Status</th><th>Contact</th><th>Next follow-up</th></tr></thead><tbody>{shown.map(c => <tr key={c.bcn}><td><Link href={`/customers/${c.bcn}`}>{c.name}</Link></td><td>{c.bcn}</td><td>{dash(c.propensityRank)}</td><td>{dash(c.propensityScore)}</td><td>{c.ownerName ?? "Unassigned"}</td><td>{c.status}</td><td>{c.contactStatus}</td><td>{dash(c.nextFollowUp)}</td></tr>)}</tbody></table><p><button disabled={current === 1} onClick={() => setPage(current - 1)}>Previous</button> Page {current} of {pages} <button disabled={current === pages} onClick={() => setPage(current + 1)}>Next</button></p></section><SamplePanel /></>;
}
function CustomerDetailView({ bcn }: { bcn: string }) {
  const { services, user } = useServices(); const [result, setResult] = useState<Result<CustomerDetail> | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  useEffect(() => { let active = true; void services.getCustomer(bcn).then(value => { if (active) setResult(value); }); return () => { active = false; }; }, [services, bcn]);
  if (!result) return <p role="status">Loading customer…</p>; if (!result.ok) return <><h1>Customer not found</h1><p role="alert">{result.error.message}</p><Link href="/customers">Back to customers</Link></>;
  const c = result.data; const readOnly = user?.role === "Sales" && c.ownerId !== user.id;
  const historyPages = Math.max(1, Math.ceil(c.histories.length / 10)); const history = c.histories.slice((historyPage - 1) * 10, historyPage * 10);
  return <><Link href="/customers">← Back to customers</Link><h1>{c.name}</h1><p><b>BCN:</b> {c.bcn} · <b>Owner:</b> {c.ownerName ?? "Unassigned"} · <b>Status:</b> {c.status}</p><p>{readOnly ? "Read-only for your role." : user?.role === "Admin" ? "Admin can manage this customer." : "You can work on this customer."}</p><h2>Customer source information</h2><dl>{Object.entries(c.source).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{dash(value)}</dd></div>)}</dl><h2>Phones</h2><ul>{c.phones.length ? c.phones.map(phone => <li key={phone}>{phone}</li>) : <li>—</li>}</ul><h2>History</h2><p>{c.histories.length} records</p><ul>{history.map(item => <li key={item.id}>{item.timestamp} · {item.actor} · {item.kind}: {item.text}</li>)}</ul><p><button disabled={historyPage === 1} onClick={() => setHistoryPage(historyPage - 1)}>Previous history</button> Page {historyPage} of {historyPages} <button disabled={historyPage === historyPages} onClick={() => setHistoryPage(historyPage + 1)}>Next history</button></p><SamplePanel /></>;
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
      {detailBcn ? <CustomerDetailView bcn={detailBcn} /> : customerRoute ? <><h1>{pathname === "/customers/mine" ? "My Customers" : "All Customers"}</h1><Customers mine={pathname === "/customers/mine"} /></> : route![2] === "Admin" && user.role !== "Admin" ? <><h1>Access denied</h1><p>This page requires the Admin role.</p><Link href="/dashboard">Back to Dashboard</Link></> : <>
        <h1>{route![1]}</h1><p>Placeholder — this functionality is not implemented yet.</p>
        <SamplePanel key={`${user.id}:${pathname}:${snapshot.revision}`} />
      </>}
    </>}
  </main>;
}
