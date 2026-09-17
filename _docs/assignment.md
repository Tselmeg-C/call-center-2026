# Assignment rules

Each admin-managed assignment rule (`assignment_rules`, `position`/`active`/`version`, plus its
eligible members in `assignment_rule_members`) replaces the old single-`ownerId`-per-rule model
with an ordered list of AND-combined conditions and a set of eligible Sales users.

## Condition fields

Conditions are evaluated against the imported `CustomerRow` columns below. `customer.status` and
`owner_id` are never condition fields.

- **Text**: `bcn`, `mbcn`, `name`, `propensity_tier`, `inside_lead`, `field_rep`, `sc_naming`,
  `inside_rep`, `branch_code`, `rsm_name`, `originating_bu`, `payment_terms`
- **Numeric**: `propensity_score`, `propensity_rank`, `revenue_amount_2024`, `revenue_amount_2025`,
  `revenue_amount_2026`, `fem_amount_2024`, `fem_amount_2025`, `fem_amount_2026`
- **Boolean**: `previously_contacted`, `recent`
- **Date**: `last_purchase_date`

## Operators by field type

Operators are trimmed and case-folded before validation.

| Field type       | Allowed operators |
|------------------|--------------------|
| Text             | `=`, `!=`, `contains`, `in`, `is-null`, `is-not-null` |
| Numeric / date    | `=`, `!=`, `<`, `<=`, `>`, `>=`, `between` (inclusive), `is-null`, `is-not-null` |
| Boolean          | `=`, `!=`, `is-null`, `is-not-null` |

Using an operator outside its field type's list is rejected with `422` at save time. `!=` never
matches a null value -- only `is-null` does. `between` requires both a low and a high bound; a
missing bound, or `low > high`, is rejected with `422` at save time (not evaluation time).
`in` requires a non-empty list of text values. `contains` is a case-folded substring match.

A rule's conditions are stored as an ordered JSON list on the rule row (`assignment_rules.conditions`),
matching how other JSON-shaped data (audit details, run results, settings) is already stored in this
codebase; there is no separate condition-order column.

## Input limits

Rule create (`POST /admin/assignment-rules`) and update (`PATCH /admin/assignment-rules/{id}`)
bodies are checked before anything is stored, in memory and PostgreSQL mode alike. A malformed body
returns `422 {"detail": "Invalid request."}`; a condition value error returns `422` with its message.

- Unknown fields on the rule body or on a condition are rejected. `null` is rejected for every field.
- `name`: trimmed on create and PATCH, 1-120 characters; duplicates (case-insensitive) return `409`.
- `active`: JSON boolean only. `order` (PATCH): JSON integer from 1 to 1,000,000; rules may share one.
- `version` (PATCH): JSON integer; a mismatch returns `409`. Omit it to skip the check.
- PATCH must carry at least one of `name`, `conditions`, `memberIds`, `active`, `order`; an empty
  body or a body with only `version` returns `422` and does not bump the assignment version.
- `conditions`: a list of at most 50 objects; `field` and `operator` are strings of at most 64
  characters.
- Text values (`=`, `!=`, `contains`): non-empty, not whitespace-only, at most 255 characters.
- `in`: 1-500 items, each a non-empty string of at most 255 characters.
- Numeric values: finite numbers only (`NaN`/`Infinity` are rejected), at most 64 characters.
- Date values: strictly `YYYY-MM-DD`.
- `memberIds`: a list of at most 100 strings, each 1-120 characters (duplicates are removed).

Manual assignment, assignment runs and the fallback list are checked the same way (`422 {"detail": "Invalid request."}`,
nothing stored, the rejected `submissionId` stays usable). `submissionId` is 1-120 characters with at
least one non-whitespace character.

- Manual assignment (`POST /admin/assignments/manual/{bcn}`): only `ownerId`, `submissionId`,
  `expectedVersion`. `ownerId` is required and is `null` (unassign) or a string of 1-120 characters;
  a well-formed id that is not an active Sales user returns `422 "Owner must be an active Sales user."`.
  `expectedVersion` may be omitted or `null`, otherwise a JSON integer from 0 to 2,147,483,647; a
  stale value returns `409`.
- Assignment runs (`POST /admin/assignment-runs` and `POST /admin/assignments/run`): only `scope`
  and `submissionId`. `scope` is exactly `unassigned` or `all-open` and defaults to `unassigned`.
- Fallback (`PUT /admin/assignment-fallback`): a JSON array of at most 100 strings, each 1-120
  characters. `[]` clears it, duplicates are removed, and an id that is not an active Sales user
  returns `422 "Fallback members must be active Sales users."`.

## Eligible members

A rule's eligible members live in `assignment_rule_members` (`rule_id`, `user_id`; unordered, no
order column). Only active Sales users can be added, and a rule must have at least one eligible
member -- saving a rule with zero eligible members is rejected with `422`, the same way
`set_assignment_fallback` rejects an invalid fallback list.

## Evaluation algorithm

1. Walk active rules in `position` order (the existing column already used by `ordered_rules()`),
   with ties broken by ascending `id` using plain string comparison (so `rule-10` comes before
   `rule-2`). Memory mode, PostgreSQL mode and the frontend mock all use this same order.
2. A rule matches a candidate customer only if **every** one of its conditions matches (AND). A
   rule with zero conditions matches unconditionally.
3. On match, the rule's eligible members are re-filtered to users who are *currently* active Sales
   (a member added while active-Sales but since deactivated or role-changed is silently skipped,
   not removed from storage). If that filtered set is empty, a warning is logged and evaluation
   continues to the next rule.
4. If no rule matches (or every matching rule's eligible set was empty), the existing global
   `fallback_sales` setting is used, filtered the same way.
5. If the fallback set is also empty, ownership is left unchanged and a warning is logged
   ("No eligible salesperson"); the customer counts toward the bulk run's existing `skipped` total,
   the same way other no-op outcomes are already reported.

## Candidate selection (workload balancing)

Among a matched rule's (or the fallback's) eligible members, the member with the fewest
currently open-owned customers (`status = 'Open'`, live count) is picked; ties are broken by
ascending `user_id`. Within a single bulk run, each pick's in-run count is bumped immediately
after it is chosen, so multiple candidates picked in the same run are spread across eligible
members instead of piling onto one. Cross-run/concurrent-run atomicity of workload counts is out
of scope (see the assignment issue tracker); a single run's transaction still serializes on its
own `(actor_id, submission_id)` key as before.
