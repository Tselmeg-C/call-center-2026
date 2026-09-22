/**
 * Two-role product demo recording: Admin sets the desk up, Sales works the queue,
 * Admin reads the result. One continuous video, three sign-ins.
 *
 *   npx tsx demo/record-demo.ts                 # visible browser
 *   DEMO_HEADLESS=1 npx tsx demo/record-demo.ts # no display (CI, containers)
 *
 * Writes only to synthetic dev data: it records an interaction, a follow-up and a note,
 * closes and immediately reopens one customer, and reassigns a customer that is unassigned.
 * It deletes nothing and never leaves a customer closed or a user deactivated.
 */
import { chromium, type Locator, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

const BASE_URL = (process.env.DEMO_URL || "https://frontend-development-83f4.up.railway.app").replace(/\/$/, "");
// Visible browser by default; DEMO_HEADLESS=1 for a machine with no display.
const HEADLESS = process.env.DEMO_HEADLESS === "1";
// The workbook the Admin act uploads. Override with DEMO_XLSX; the path is resolved on the
// machine running this script, which is also the machine running the browser.
const SAMPLE_XLSX = path.resolve(process.env.DEMO_XLSX || "data/sample.xlsx");
const DEMO_RULE = "Demo — Branch XD";

/* Credentials live in the gitignored .test_accounts (KEY=value per line) and are never printed. */
function loadAccounts(file = path.resolve(".test_accounts")): Record<string, string> {
  const accounts = Object.fromEntries(
    readFileSync(file, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const split = line.indexOf("=");
        return [line.slice(0, split).trim(), line.slice(split + 1).trim().replace(/^["']|["']$/g, "")] as const;
      }),
  );
  for (const key of ["email_admin", "email_sales1", "email_sales2", "password"]) {
    if (!accounts[key]) throw new Error(`${file} is missing ${key}`);
  }
  return accounts;
}

const accounts = loadAccounts();
const outputDir = path.resolve("demo/output");
mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: HEADLESS,
  // slowMo paces every action so the recording reads as a person working, not a script.
  slowMo: 350,
  args: ["--window-size=1920,1080", "--window-position=0,0"],
});

const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: outputDir, size: { width: 1920, height: 1080 } },
});

const page = await context.newPage();

/** Let a screen settle so a viewer can read it. */
const beat = (ms = 2000) => page.waitForTimeout(ms);
const step = (name: string) => console.log(`  · ${name}`);
const act = (name: string) => console.log(`\n${name}`);
const present = async (locator: Locator) => (await locator.count()) > 0;

async function signIn(email: string, who: string) {
  step(`Sign in as ${who}`);
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Sign in" }).waitFor();
  await beat(1500);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(accounts["password"]!);
  await beat(1000);
  await page.getByRole("button", { name: "Sign in" }).click();
  // The root AuthGate navigates off /login once the session cookie lands.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
  await page.getByRole("navigation").waitFor();
  await beat(2500);
}

async function signOut() {
  await page.getByTitle("Sign out").click();
  await beat(1500);
  // Sign-out revokes the session but leaves a blank page instead of redirecting (issue #121),
  // so navigate to /login ourselves rather than record the blank screen.
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Sign in" }).waitFor({ timeout: 30_000 });
  await beat(1200);
}

/** Click a sidebar entry and wait for its page heading. */
async function open(navLabel: string, heading: string | RegExp = navLabel) {
  step(navLabel);
  await page.getByRole("link", { name: navLabel }).click();
  await page.getByRole("heading", { name: heading }).waitFor();
  await beat(2500);
}

/** Click a dashboard bucket tile and let its table render. */
async function showBucket(label: string) {
  step(`Bucket — ${label}`);
  await page.getByRole("button", { name: new RegExp(label, "i") }).click();
  await page.getByRole("heading", { name: label }).waitFor();
  await beat(2500);
}

/* ─────────────────────────── ACT 1 — ADMIN SETS UP THE DESK ─────────────────────────── */

act("Act 1 — Admin sets up the desk");

await signIn(accounts["email_admin"]!, "admin");

step("Dashboard — admins have no personal queue");
await page.getByRole("heading", { name: /^Today,/ }).waitFor();
await beat(3000);

// Users & Roles: the roster, then a deactivate/reactivate round-trip on the second Sales
// account. Done before any assignment below, so releasing their customers cannot strand
// the customer the Sales act depends on.
await open("Users & Roles");
// The display name of the account Act 2 signs in as — the manual reassignment below routes a
// customer to them, so the Sales act always has something in its queue.
const salesRow = page.getByRole("row").filter({ hasText: accounts["email_sales1"]! });
const salesName = (await present(salesRow)) ? (await salesRow.getByRole("cell").first().innerText()).trim() : null;
const sales2Row = page.getByRole("row").filter({ hasText: accounts["email_sales2"]! });
if (await present(sales2Row)) {
  step("Deactivate a salesperson — their open customers release to the pool");
  await sales2Row.getByRole("button", { name: "Deactivate" }).click();
  await beat(2500);
  step("Reactivate them");
  await sales2Row.getByRole("button", { name: "Activate" }).click();
  await beat(2500);
} else {
  step("Skipped deactivate/reactivate — second sales account not in the table");
}

// Excel Import: re-importing the sample workbook is an idempotent update of the same rows.
await open("Excel Import");
if (existsSync(SAMPLE_XLSX)) {
  step("Upload the customer workbook");
  await page.locator('input[type="file"]').setInputFiles(SAMPLE_XLSX);
  await page.getByText("Import completed").waitFor({ timeout: 60_000 });
  await beat(3500); // rows processed / created / updated / errors tiles
  step("Import history");
  await beat(2000);
} else {
  step(`Skipped import — ${SAMPLE_XLSX} not found`);
}

// Assignment: authoring, the rules list, a run, and a manual override.
await open("Assignment");

const existingRule = page.getByText(DEMO_RULE, { exact: true });
if (!(await present(existingRule))) {
  step("Author an assignment rule");
  await page.getByRole("button", { name: "Add rule" }).click();
  await page.getByLabel("Rule name").waitFor();
  await page.getByLabel("Rule name").fill(DEMO_RULE);
  await beat(1200);
  // The create form opens with one blank condition, and an empty value fails validation.
  // Changing the field resets the value slots, so set the field before the value.
  const condition = page.getByRole("group", { name: "Condition 1" });
  await condition.getByLabel("Field").click();
  await page.getByRole("option", { name: "Branch code" }).click();
  await beat(800);
  await condition.getByLabel("Value").fill("XD");
  await beat(1200);
  // Members are checkboxes labelled with each salesperson's name.
  const members = page.getByRole("group", { name: "Eligible members" }).getByRole("checkbox");
  if (await present(members)) await members.first().check();
  await beat(1000);
  // Saved inactive on purpose: the rule demonstrates authoring without silently
  // re-owning customers the rest of this demo depends on.
  await page.getByLabel("Active").click(); // Radix Switch, defaults on — one click turns it off
  await beat(1000);
  await page.getByRole("button", { name: "Create rule" }).click();
  await page.getByText(DEMO_RULE, { exact: true }).waitFor({ timeout: 30_000 });
  await beat(2500);
} else {
  step("Assignment rules — priority ordered, first match wins");
  await beat(2500);
}

step("Run assignment — rules first, then workload balancing");
await page.getByRole("button", { name: /^Run assignment/ }).click();
await beat(3000);

// Manual override, aimed at a customer nobody owns so the Sales act keeps its own.
await open("All Customers");
const unassignedRow = page.getByRole("row").filter({ hasText: "Unassigned" }).first();
const unassignedName = (await present(unassignedRow))
  ? (await unassignedRow.getByRole("link").first().innerText()).trim()
  : null;
await beat(2000);

await open("Assignment");
if (unassignedName) {
  step(`Manual reassignment — ${unassignedName}`);
  await page.getByRole("combobox").filter({ hasText: "Select customer" }).click();
  await page.getByRole("option", { name: new RegExp(unassignedName) }).first().click();
  await beat(1000);
  await page.getByRole("combobox").filter({ hasText: "New owner" }).click();
  await (salesName ? page.getByRole("option", { name: salesName, exact: true }) : page.getByRole("option").last()).click();
  await beat(1000);
  await page.getByRole("button", { name: "Reassign" }).click();
  await beat(2500);
  step("Assignment history and workload");
  await beat(2500);
} else {
  step("Skipped manual reassignment — every customer already has an owner");
}

await open("Audit Log");

/* ─────────────────────────── ACT 2 — SALES WORKS THE QUEUE ─────────────────────────── */

act("Act 2 — Sales works the queue");

await signOut();
await signIn(accounts["email_sales1"]!, "sales");

step("Dashboard — Today's Outreach");
await page.getByRole("heading", { name: /^Today,/ }).waitFor();
await beat(3000);

// NOTE: the first three buckets read 0 until issue #118 lands — GET /customers omits
// followUps, so the store never sees an open follow-up (apps/api/main.py:495).
await showBucket("Overdue follow-ups");
await showBucket("Follow-ups due today");
await showBucket("Follow-ups without date");
await showBucket("Never contacted");
await showBucket("Other assigned customers");

await open("My Customers");

step("Sort by propensity rank");
await page.getByRole("combobox").first().click();
await page.getByRole("option", { name: "Sort: propensity rank" }).click();
await beat(2500);

step("Include closed customers");
await page.getByLabel("Include closed").click();
await beat(2000);
await page.getByLabel("Include closed").click();
await beat(1500);

step("Open a customer");
// Only the customer-name cell is a link; the row itself does not navigate (CustomerTable.tsx).
const customerLink = page.getByRole("table").getByRole("link").first();
if (!(await present(customerLink))) {
  throw new Error(
    "No customers assigned to this sales account — Act 1's manual reassignment did not route one here. " +
      "Check that an unassigned customer existed and that the sales account is active.",
  );
}
const customerName = (await customerLink.innerText()).trim();
await beat(1000);
await customerLink.click();
await page.waitForURL(/\/customer\//, { timeout: 30_000 });
await page.getByRole("heading", { name: customerName }).waitFor();
await beat(2500);

step("Master data — contact details and commercial history");
await page.getByRole("tab", { name: "Master data" }).click();
await page.getByText("Phone numbers").waitFor();
await beat(3000);

step("Interaction history");
await page.getByRole("tab", { name: /^Interactions/ }).click();
await beat(2500);

// The two selects on this page, in DOM order: "Record interaction", then "Schedule follow-up".
// Everything else below has a page-unique label, placeholder or button name.
const outcomeSelect = page.getByRole("combobox").first();
const followUpSelect = page.getByRole("combobox").nth(1);

step("Record a contact outcome");
await outcomeSelect.click();
await page.getByRole("option", { name: /Contact/ }).click();
await beat(1000);
await page.getByPlaceholder("Call note (optional)").fill("Spoke with the buyer — interested, quote to follow.");
await beat(1500);
// When a reminder prompted the call, close it out with the outcome — the real workflow.
// That button stays disabled until #118 lands, hence the fallback.
const completeFollowUp = page.getByRole("button", { name: "Save & complete follow-up" });
const saveActivity = page.getByRole("button", { name: "Save activity" });
await ((await completeFollowUp.isEnabled()) ? completeFollowUp : saveActivity).click();
await page.getByText(/Contact recorded/).waitFor();
await beat(2500);

step("Schedule the next reminder");
await followUpSelect.click();
await page.getByRole("option", { name: "Salesperson reminder" }).click();
await beat(1000);
// Due today, so the dashboard moves this customer into "Follow-ups due today".
const due = new Date();
due.setHours(12, 0, 0, 0);
await page.getByLabel(/Due date/).fill(new Date(due.getTime() - due.getTimezoneOffset() * 60_000).toISOString().slice(0, 16));
await page.getByPlaceholder("Follow-up note (optional)").fill("Call back with pricing.");
await beat(1500);
await page.getByRole("button", { name: "Add follow-up" }).click();
await page.getByText("Follow-up scheduled").waitFor();
await beat(2000);

step("The follow-up on the record");
await page.getByRole("tab", { name: /^Follow-ups/ }).click();
await beat(3000);

step("Add a note");
await page.getByPlaceholder(/Context, contacts, preferences/).fill("Buys through the Samsung line; prefers a morning call.");
await beat(1200);
await page.getByRole("button", { name: "Save note" }).click();
await beat(1500);
await page.getByRole("tab", { name: /^Notes/ }).click();
await beat(2500);

step("Ownership history");
await page.getByRole("tab", { name: "Ownership" }).click();
await beat(3000);

// Lifecycle round-trip: close with a reason, then reopen. History survives both.
const closeButton = page.getByRole("button", { name: "Close customer" });
if (await closeButton.isEnabled()) {
  step("Close the customer with a reason");
  await closeButton.click();
  await page.getByRole("button", { name: "Reopen customer" }).waitFor({ timeout: 30_000 });
  await beat(3000);
  step("Reopen it — nothing was overwritten");
  await page.getByRole("button", { name: "Reopen customer" }).click();
  await page.getByRole("button", { name: "Close customer" }).waitFor({ timeout: 30_000 });
  await beat(2500);
} else {
  step("Skipped close/reopen — no active closure reason configured");
}

step("Back to the dashboard — updated");
await page.getByRole("link", { name: "Dashboard" }).click();
await page.getByRole("heading", { name: /^Today,/ }).waitFor();
await beat(2500);
await showBucket("Follow-ups due today");

/* ─────────────────────────── ACT 3 — ADMIN READS THE RESULT ─────────────────────────── */

act("Act 3 — Admin reads the result");

await signOut();
await signIn(accounts["email_admin"]!, "admin");

await open("Reporting", "Reporting & KPIs");
step("Attempts vs contacts, and closure reasons");
await beat(3500);

await open("Audit Log");
step("The whole session, in order");
await beat(3500);

step("Finish on the dashboard");
await page.getByRole("link", { name: "Dashboard" }).click();
await page.getByRole("heading", { name: /^Today,/ }).waitFor();
await beat(3000);

/* ─────────────────────────────────────── FINISH ─────────────────────────────────────── */

const video = page.video();
await context.close();
await browser.close();

if (!video) throw new Error("Playwright recorded no video.");
const webm = await video.path();
const mp4 = path.join(outputDir, "call-center-demo.mp4");

console.log("\nConverting to MP4…");
execFileSync(
  "ffmpeg",
  ["-y", "-i", webm, "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", mp4],
  { stdio: "inherit" },
);

rmSync(webm, { force: true }); // the mp4 is the deliverable; don't accumulate raw takes
console.log(`Demo video created: ${mp4}`);
