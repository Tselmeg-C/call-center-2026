# Administration

Admins manage synthetic users and closure reasons from the settings routes. Names and emails are trimmed and validated; email and reason labels are case-insensitively unique across inactive records. Users are deactivated rather than deleted. Deactivating or promoting Sales releases their open customers to Unassigned while preserving closed ownership and history. An active Admin is always required, and the current session cannot demote or deactivate itself.

Closure history stores the label snapshot at close time. Settings changes therefore do not rewrite past customer history.

## Closure reason input rules (API)

`POST /admin/closure-reasons` accepts only `label`; `PATCH /admin/closure-reasons/{id}` accepts only `label` and `active`, at least one of them. A malformed body returns `422 {"detail": "Invalid request."}` and writes nothing (no audit event):

- `label` is trimmed, then must be 1-120 characters. A duplicate label (case-insensitive, after trimming) returns `409`.
- `active` is a JSON boolean. An explicit `null` for either field, or an empty PATCH body `{}`, is rejected.
