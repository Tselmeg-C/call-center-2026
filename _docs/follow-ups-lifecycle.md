# Follow-ups and customer lifecycle

Follow-ups are separate records with type `Appointment`, `Reminder`, or `Follow-up needed`. Appointments use a future UTC timestamp, reminders use a UTC date or timestamp, and undated follow-ups carry no due value. Date-only values stay date-only and are compared with the UTC calendar date. The next action is the earliest open dated follow-up, with undated work after dated work and stable ID ordering for ties.

The current owner or an Admin may create, edit, cancel, and complete follow-ups. Editing is limited to open records and records before/after values in history. Cancellation retains the record and creates a history event. Completion creates one linked interaction and retains both records. Submission IDs make retries idempotent; a new submission against a completed or cancelled record returns a conflict.

An interaction may create one linked follow-up atomically. Follow-up notes are trimmed and limited to 4,000 characters. Open customers close with one of seven seeded reasons; closing cancels open follow-ups and records the reason and actor. Reopening retains all history and cancelled work. All lifecycle timestamps are UTC and every mutation is mock-only and in memory.

## Follow-up input rules (API)

- `type` is exactly `Appointment` or `Reminder`. "Follow-up needed" is stored as a `Reminder` with no `due`.
- `due` is `null`/omitted, a `YYYY-MM-DD` date, or an ISO-8601 datetime with an offset (`Z` or `±hh:mm`). A datetime without an offset, a malformed value, or a value before `2000-01-01` or after now + 5 years (UTC) returns `422`. Past values inside that range are accepted (overdue is a normal state).
- An `Appointment` requires a `due`.
- `note` is trimmed, then must be 1-4,000 characters. `submissionId` is 1-120 characters with at least one non-whitespace character.
- Unknown fields are rejected with `422`. Completion `outcome` is exactly `Attempt` or `Contact`; its `note` is optional and at most 4,000 characters.

## Close and reopen input rules (API)

Malformed bodies return `422 {"detail": "Invalid request."}` before anything is stored, and a rejected request does not use up its `submissionId` (1-120 characters with at least one non-whitespace character).

- Close (`POST /customers/{bcn}/close`) accepts only `reasonId` and `submissionId`. `reasonId` is required: a string of 1-120 characters. A well-formed but unknown or inactive reason returns `422 "Choose an active closure reason."`. Replaying a completed close with the same body returns the original result even if the reason was deactivated since.
- Reopen (`POST /customers/{bcn}/reopen`) accepts only `submissionId`; a `reasonId` or any other field is rejected.
