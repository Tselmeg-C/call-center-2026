# Demo recording

`demo/record-demo.ts` drives a real browser through the product and records the session as a
video: Admin sets the desk up, Sales works the queue, Admin reads the result. It is a Playwright
script, not a test — nothing asserts, and a failure means the recording stopped, not that the
product regressed.

## Running it

```sh
npx tsx demo/record-demo.ts                 # visible browser (a machine with a display)
DEMO_HEADLESS=1 npx tsx demo/record-demo.ts # no display (CI, containers, codespaces)
```

Everything it needs is already a dev dependency (`@playwright/test`, `tsx`); `ffmpeg` must be on
`PATH`, and Playwright's chromium must be installed (`npx playwright install chromium`). On a
machine with no display, wrap it: `xvfb-run -a --server-args="-screen 0 1920x1080x24" …`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DEMO_URL` | the `development` frontend | Target deployment |
| `DEMO_HEADLESS` | unset (visible) | `1` runs headless |
| `DEMO_XLSX` | `data/sample.xlsx` | Workbook the Admin act uploads; resolved on the machine running the browser |

Output is `demo/output/call-center-demo.mp4` (1920×1080, h264). The raw `.webm` is deleted after
conversion, and `demo/output/` is gitignored.

`demo/package.json` exists only to mark the directory ESM — the script uses top-level `await`,
which esbuild refuses to transpile under the repo's CommonJS default.

## Credentials

Logins come from `.test_accounts` at the repo root — a gitignored `KEY=value` file with
`email_admin`, `email_sales1`, `email_sales2` and a single shared `password`. The script reads it
directly and never prints it; the recording only ever shows a masked password field. Per
`AGENTS.md`, do not echo, commit or paste those values anywhere.

## What it records

Three acts, three sign-ins, one continuous video, finishing on the dashboard.

**Act 1 — Admin sets up the desk**

1. Sign in as admin; the dashboard says admins have no personal queue.
2. Users & Roles: the roster, then deactivate and reactivate a salesperson. Done before any
   assignment, so releasing their customers cannot strand the customer Act 2 depends on.
3. Excel Import: upload the workbook, hold on the rows processed / created / updated / errors
   tiles, then the import history.
4. Assignment: author a rule (field, operator, value, eligible members) and save it **inactive**,
   so authoring is demonstrated without silently re-owning customers the rest of the demo needs.
5. Run assignment — rules first, then workload balancing.
6. Manual reassignment: route an unassigned customer to the account Act 2 signs in as, so the
   Sales act always has a queue regardless of the environment's current ownership.
7. Audit Log: everything above, in order.

**Act 2 — Sales works the queue**

1. Sign in as sales; the dashboard greets them with their active customer count.
2. Each of the five buckets: overdue, due today, undated, never contacted, other assigned.
3. My Customers: sort by propensity rank, toggle "Include closed".
4. Open a customer — only the customer-name cell is a link; the row itself does not navigate.
5. Master data: contact details, propensity, revenue and FEM by year, sales organisation, vendors.
6. Interaction history, then record a contact outcome with a call note.
7. Schedule a reminder dated today, so the dashboard visibly moves the customer.
8. The follow-up on the record; add a note; ownership history.
9. Close the customer with a reason, then reopen it — history survives both.
10. Back to the dashboard, landing on "Follow-ups due today".

**Act 3 — Admin reads the result**

1. Sign in as admin again.
2. Reporting: attempts vs contacts, closure reasons — populated by what the viewer just watched.
3. Audit Log: the whole session in order.
4. Finish on the dashboard.

## What it writes

Only synthetic dev data, and only what the story requires: one interaction, one follow-up and one
note on one customer; one customer closed and immediately reopened; one unassigned customer
reassigned; one salesperson deactivated and immediately reactivated; one inactive assignment rule
(created once — reruns reuse it); one workbook import, which is an idempotent update when the
workbook is `data/sample.xlsx`. It deletes nothing and never leaves a customer closed or a user
deactivated.

## Known gaps that cap the demo

- **#118** — `GET /customers` omits `followUps`, so the dashboard's overdue / due-today / undated
  buckets read `0` no matter what is scheduled, and "Save & complete follow-up" stays disabled.
  This is the single biggest hole: the dashboard's "here is my prioritised day" premise cannot be
  shown until it lands. The script handles it by falling back to "Save activity".
- **#121** — signing out leaves a blank page instead of redirecting to `/login`. The script
  navigates to `/login` itself after each sign-out so the recording never shows the blank screen.
- **#119** — no admin UI for creating users, so the demo cannot show onboarding a salesperson.
- **#120** — no admin UI for closure reasons; the environment has one ("Won"), so the Reporting
  closure breakdown can only ever show one bar.

## Before a real take

- Seed a workbook whose dates spread customers across every bucket, otherwise most of the
  dashboard reads zero even once #118 is fixed.
- Check what else has been writing to the target deployment. QA passes import bulk synthetic rows
  (e.g. `09900000`–`09904999`), which changes what "Run assignment" and "My Customers" look like.
- Re-run once end to end before recording for real; the script logs each step, so a failure names
  the beat it stopped on.

## Maintaining it

Selectors are accessible roles, labels, placeholders and visible text — not CSS. When a screen
changes, the fix is usually a renamed label, not a restructured script. Pacing comes from
`slowMo: 350` on launch plus explicit 1–3s beats after each screen; waits are on real state
(headings, toasts, URL changes), never `networkidle`.
