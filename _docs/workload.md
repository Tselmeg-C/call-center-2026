# Sales workload

The dashboard and My Customers use one UTC snapshot from the mock workload query. Only open customers assigned to the signed-in Sales user are counted.

Buckets are exclusive and evaluated in this order:

1. **Overdue** — an open dated follow-up is before the snapshot's UTC date.
2. **Due today** — otherwise an open dated follow-up is on today's UTC date. Date-times earlier today remain here.
3. **Undated follow-up** — otherwise an open follow-up has no due value.
4. **Never contacted** — otherwise there is no nondeleted application Contact and imported `previously_contacted` is not true. Attempts do not count as Contact, and future follow-ups do not override this bucket.
5. **Other** — all remaining open assigned customers.

Completed and cancelled follow-ups are ignored. Dashboard links pass `status=open&bucket=<bucket>` to My Customers, so its total comes from the same snapshot and calculation. Search and the remaining list filters narrow the selected bucket.

The boundary fixture used by behavior tests has this expected membership for a fixed snapshot of `2026-09-10T12:00:00Z`:

| Fixture | Follow-ups / history | Bucket |
| --- | --- | --- |
| `yesterday-2359` | open `2026-09-09T23:59:00Z` | Overdue |
| `today-midnight` | open `2026-09-10T00:00:00Z` | Due today |
| `today-2359` | open `2026-09-10T23:59:00Z` | Due today |
| `tomorrow-midnight` | open `2026-09-11T00:00:00Z` | Other |
| `overlap` | overdue and today open follow-ups | Overdue |
| `completed-cancelled` | only completed/cancelled dated follow-ups | Never contacted |
| `attempt-only` | application Attempt only | Never contacted |
| `imported-contact` | imported `previously_contacted: true` | Other |
| `closed` | open dated follow-up, customer closed | excluded |

