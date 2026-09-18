# Enterprise Sales Customer Contact Management App — MVP Plan

## 1. Objective
Build an internal enterprise customer-contact management application for Sales teams to manage assigned customers, record calls/interactions, schedule follow-ups, and provide Admin reporting and assignment management.

The MVP will not perform telephony. Salespeople continue to use normal phone/Teams/etc. and record the resulting activity in the application.

Deployment target: Railway, with separate development and production environments.

## 2. MVP Scope

### Sales
Sales users can:
- View assigned customers in **My Customers**
- Search/view the complete customer database in **All Customers**
- View customer master data and imported business information
- Record unlimited calls/interactions
- Record call outcomes: Attempt (no answer) or Contact (answered)
- Add notes
- Create and manage follow-ups
- Complete follow-ups by recording a new activity
- Close customers with a closure reason
- Reopen closed customers
- Delete their own activities/notes, subject to the final deletion/audit policy
- Work actively only on customers currently assigned to them

Sales can view history of customers owned by other salespeople, but cannot actively work on those customers.

### Admin
Admins can:
- View and manage all customers
- Manage users and roles
- Import Excel data
- Manage customer assignments
- Configure assignment rules
- Manually reassign customers
- View reporting/KPIs
- Manage configurable values such as closure reasons
- Access audit information
- Override Sales ownership restrictions

## 3. Technology Stack
- Frontend: Next.js + TypeScript
- UI: Ant Design
- Backend: Python FastAPI
- API: REST
- DB: PostgreSQL
- ORM/migrations: SQLAlchemy + Alembic
- Deployment: Railway, separate dev/prod
- Repository: Monorepo

Suggested structure:
```text
/
├── apps/
│   ├── web/                 # Next.js frontend
│   └── api/                 # FastAPI backend
├── packages/
│   └── shared/              # Shared types/contracts where useful
├── infra/
├── docs/
├── plan.md
└── README.md
```

## 4. Architecture Principles
1. Keep customer master data independent from sales activities.
2. Treat `bcn` as the immutable primary customer identifier.
3. Never overwrite activities, notes, follow-ups, or assignment history during imports.
4. Separate imported/source attributes from application-generated operational data.
5. Keep authentication abstract enough to support future Microsoft Entra ID/SSO.
6. Design the customer master-data ingestion layer so Excel can later be replaced or supplemented by BigQuery.
7. Use strong types for fields needed for filtering, assignment, reporting, and sorting.
8. Keep the model extensible for additional customer attributes.
9. Use audit/history for important administrative and ownership changes.

## 5. Customer Master Data

### Primary identity
`bcn` is the primary and immutable customer ID.
`MBCN` is retained as a customer attribute but is not the primary identifier.
Customer names are not required to be unique.

### Source Excel fields
```text
bcn | MBCN | customer_name | phone | previously_contacted |
propensity_score | propensity_tier | propensity_rank |
Inside_Lead | Field_Rep | SC_Naming | Inside_Rep | Branch_Code |
RSM_Name | Originating_BU | LAST_PURCHASE_DATE | recent |
REVENUE_AMOUNT_2024 | REVENUE_AMOUNT_2025 | REVENUE_AMOUNT_2026 |
FEM_AMOUNT_2024 | FEM_AMOUNT_2025 | FEM_AMOUNT_2026 |
Payment_Terms |
vendor_1 | vendor_1_revenue | vendor_2 | vendor_2_revenue |
vendor_3 | vendor_3_revenue |
category_1 | category_1_revenue | category_2 | category_2_revenue |
category_3 | category_3_revenue
```

### Logical categories
**Identity**
- bcn
- MBCN
- customer_name
- phone

**Prioritization / propensity**
- previously_contacted
- propensity_score
- propensity_tier
- propensity_rank
- recent

**Sales organization**
- Inside_Lead
- Field_Rep
- SC_Naming
- Inside_Rep
- Branch_Code
- RSM_Name
- Originating_BU

**Purchase / revenue**
- LAST_PURCHASE_DATE
- REVENUE_AMOUNT_2024/25/26

**FEM revenue**
- FEM_AMOUNT_2024/25/26

**Commercial**
- Payment_Terms

**Vendor performance**
- vendor_1 + revenue
- vendor_2 + revenue
- vendor_3 + revenue

**Category performance**
- category_1 + revenue
- category_2 + revenue
- category_3 + revenue

### Field behavior
Core identity and operationally important fields should be strongly typed.
Other imported attributes may be nullable.
Vendor/category pairs should remain extensible; child tables are preferred if frequent filtering/reporting is required, otherwise JSON may be considered during implementation.

### Phone numbers
A customer may have multiple phone numbers. Model phone numbers separately. The current Excel `phone` field initially populates the primary phone number.

## 6. Excel Import

### MVP flow
1. Admin uploads Excel.
2. System validates the file.
3. System imports immediately.
4. System displays:
   - rows processed
   - customers created
   - customers updated
   - errors

No preview or column-mapping UI is required for MVP.

### Upsert behavior
- Existing `bcn` → update customer master data.
- New `bcn` → create customer.
- Never overwrite activities, notes, follow-ups, assignment history, current ownership, or other application-generated history.

`previously_contacted` is historical source information, separate from application activities.

Example:
```text
previously_contacted = true
Application activities = 0
```
means the source system says the customer was contacted historically, while this application has no recorded interaction.

### `recent`
`recent` is a binary imported source flag (`true`/`false`). The application does not calculate or reinterpret it in MVP. It can be used for filtering/prioritization.

## 7. Roles and Permissions

### Admin
Full access.

### Sales
Can:
- View all customers
- View all customer history
- Work on currently assigned customers
- Add activities and notes
- Create/complete follow-ups
- Close/reopen customers

Sales cannot actively modify customers owned by another salesperson. Admin can override.

## 8. Sales Navigation

### Dashboard
Today buckets:
1. Overdue follow-ups
2. Follow-ups due today
3. Follow-ups without date
4. Never contacted
5. Other assigned customers

Clicking a bucket opens a detailed customer list.

### My Customers
All currently assigned customers.

Default priority:
1. Overdue
2. Due today
3. Undated follow-up
4. Never contacted
5. Other assigned customers ordered by propensity/ranking

Search/filter/sort are supported.

### All Customers
Complete customer database. Sales can search/view all customers and history. Records owned by another salesperson are read-only.

## 9. Customer Detail
Show:
- Company/customer name
- Customer ID (`bcn`)
- Other identity attributes
- Phone number(s)
- Address, when available
- Propensity/ranking
- Revenue
- Last purchase
- Imported business metadata
- Current salesperson
- Contact status
- Complete interaction history
- Notes
- Follow-up history
- Current next-action status

Current owner actions:
- Add interaction
- Add note
- Schedule follow-up
- Complete follow-up
- Close customer
- Reopen customer

## 10. Activities / Interaction History
Every call is a separate activity; history is unlimited.

### Attempt
Call made, no answer. Record date/time, salesperson, optional note, and whether follow-up is needed. Multiple attempts are allowed.

### Contact
Call answered. Record date/time, salesperson, optional note, and whether follow-up is needed. Multiple contacts are allowed.

Activities remain in history and are never replaced by later activities.

## 11. Follow-ups
Three types:
1. Customer appointment — date/time committed with customer.
2. Salesperson reminder — personal reminder, date or date/time.
3. Follow-up needed — no date.

Completing a follow-up creates a new activity. It does not erase the original follow-up or previous interaction.

## 12. Customer Lifecycle
Conceptual:
```text
Never contacted → Attempt → Contact → Follow-up → Closed
```
Current status is separate from immutable activity history.

### Closing
Requires a reason. Initial reasons:
- Not interested
- Do not contact
- Invalid/wrong contact
- Customer already handled
- Customer relationship ended
- Successfully completed
- Other

Closure reasons should be Admin-configurable later.

### Reopening
Sales can reopen a closed customer. Closure remains in history.

## 13. Customer Ownership
Exactly one active owner per customer.
Reassignment is allowed.
All assignment changes are preserved in assignment history.
A new owner sees previous interactions, notes, follow-ups, and history.
Import never automatically changes ownership.

## 14. Assignment Engine
Admin explicitly triggers assignment.

Hybrid:
- configurable rule-based assignment
- balanced workload fallback

### Rules
Priority ordered, first-match-wins.
Each rule has:
- conditions
- eligible salespeople
- priority/order
- active/inactive state

Rules may use:
- propensity rank/score
- revenue
- last purchase date
- sales organization fields
- other imported attributes

### Fallback
If no rule matches, assign to an eligible salesperson with the fewest active/open customers.
Closed customers do not count toward workload.

### Admin actions
- Assign unassigned customers
- Reassign selected customers
- Reassign all eligible customers

Bulk reassignment excludes closed customers by default. Manual reassignment can handle closed customers.

### Deactivated salesperson
- Cannot log in/work
- Active customers become unassigned
- Assignment history preserved
- Closed customers need no redistribution
- Admin explicitly runs assignment engine to redistribute active customers

## 15. Reporting / KPIs
Admin reports:
- Customers assigned per salesperson
- Active vs closed
- Never contacted
- Attempts
- Successful contacts
- Follow-ups due
- Overdue follow-ups
- Completed follow-ups
- Contact rate = contacts / attempts
- Closure reasons
- Activity over time

No sales/order conversion integration in MVP.

## 16. Authentication
MVP:
- Email/password
- Role-based authorization

Authentication should be abstracted for future Microsoft Entra ID/SSO.

Security baseline:
- TLS
- Secure password hashing
- Server-side authorization
- Secure session/token handling
- Railway/environment-based secrets
- Audit logging for important administrative actions

## 17. Audit / History
Important actions should be auditable:
- Customer ownership changes
- User activation/deactivation
- Assignment-rule changes
- Imports
- Customer master-data updates where appropriate
- Customer closure/reopening
- Administrative overrides
- Deletion actions

Hard-delete vs soft-delete for activities/notes remains open; enterprise-safe default is soft delete plus audit trail.

## 18. Extensibility
Future capabilities:
- BigQuery ingestion
- Microsoft Entra ID / SSO
- More sophisticated assignment rules
- Additional activity types
- Email integration
- Teams integration
- Telephony integration
- Sales/order conversion data
- Advanced analytics
- Flexible customer attributes

Excel and future BigQuery ingestion should feed the same customer master-data layer.

## 19. Conceptual Data Model
```text
User
 └── role

Customer
 ├── customer_phones
 ├── activities
 ├── followups
 ├── notes
 ├── assignment_history
 └── imported/source attributes

AssignmentRule
 ├── conditions
 └── eligible salespeople

ImportJob
 └── import_errors

AuditLog
```

Exact relational schema will be finalized during implementation.

## 20. Key Business Rules
1. `bcn` is immutable and uniquely identifies a customer.
2. Customer names do not need to be unique.
3. Import updates customer master data but never operational history.
4. `previously_contacted` describes historical source information.
5. `recent` is a binary imported flag for MVP.
6. Every call is a separate activity.
7. Activities are never replaced by later activities.
8. A customer has exactly one active owner.
9. Ownership changes preserve history.
10. Only the current owner can actively work on a customer; Admin can override.
11. Closed customers are excluded from normal assignment workload.
12. Closed customers can be reopened.
13. Closing requires a reason.
14. Assignment rules are priority ordered and first-match-wins.
15. No-rule matches use balanced workload-based distribution.
16. Import does not trigger automatic reassignment.
17. Sales can view all customer records but cannot modify records owned by another salesperson.
18. MVP has no embedded telephony.

## 21. Open Decisions Before Implementation
- Exact Excel validation behavior
- Duplicate `bcn` rows within one Excel file
- Missing/invalid required fields
- Phone-number normalization/validation
- Exact assignment-rule operators and AND/OR grouping
- Null handling in assignment rules
- Activity/note deletion behavior
- Password reset/account recovery
- Session/token expiration
- Audit-log retention
- Customer address editing in MVP
- Whether multiple open follow-ups are allowed
- Follow-up cancellation/editing behavior
- Exact database schema
- API endpoint design
- UI wireframes/page details
- Automated testing strategy
- Railway CI/CD and environment configuration
- Backup/recovery expectations

## 22. Implementation Phases

### Phase 1 — Foundation
- Monorepo
- Next.js
- FastAPI
- PostgreSQL
- SQLAlchemy/Alembic
- Railway dev/prod
- Environment configuration
- Basic CI/CD

### Phase 2 — Authentication and Users
- Email/password
- User model
- Admin/Sales roles
- Authorization
- User administration

### Phase 3 — Customer Master Data
- Customer model
- Phone model
- Imported attributes
- Excel ingestion
- Upsert by `bcn`
- Import results/errors

### Phase 4 — Activities and Follow-ups
- Activities
- Call outcomes
- Notes
- Follow-ups
- Completion workflow
- Lifecycle/closure

### Phase 5 — Ownership and Assignment
- Assignment/history
- Assignment rules
- Balanced fallback
- Admin assignment UI
- Deactivated-user handling

### Phase 6 — Sales UI
- Dashboard
- My Customers
- All Customers
- Customer detail
- Search/filter/sort
- Follow-up workflows

### Phase 7 — Admin UI and Reporting
- User management
- Import management
- Assignment configuration
- KPI dashboards/reports
- Audit log

### Phase 8 — Hardening
- Automated tests
- Security review
- Error handling
- Logging/monitoring
- Performance testing
- Production deployment
- Backup/recovery validation

## 23. MVP Success Criteria
The MVP is successful when:
1. Admin can import the Excel source.
2. Customers are created/updated using `bcn`.
3. Existing activities and ownership survive re-imports.
4. Admin can assign customers using configurable rules.
5. Sales can see their assigned workload.
6. Sales can search the full customer database.
7. Sales can record attempts and contacts.
8. Sales can create and complete follow-ups.
9. Sales can close and reopen customers.
10. Admin can see assignment and activity KPIs.
11. Customer and ownership history is preserved.
12. The application runs reliably in Railway dev and production.
