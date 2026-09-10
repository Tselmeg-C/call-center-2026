# Follow-ups and customer lifecycle

Follow-ups are separate records with type `Appointment`, `Reminder`, or `Follow-up needed`. Appointments use a future UTC timestamp, reminders use a UTC date or timestamp, and undated follow-ups carry no due value. Date-only values stay date-only and are compared with the UTC calendar date. The next action is the earliest open dated follow-up, with undated work after dated work and stable ID ordering for ties.

The current owner or an Admin may create, edit, cancel, and complete follow-ups. Editing is limited to open records and records before/after values in history. Cancellation retains the record and creates a history event. Completion creates one linked interaction and retains both records. Submission IDs make retries idempotent; a new submission against a completed or cancelled record returns a conflict.

An interaction may create one linked follow-up atomically. Follow-up notes are trimmed and limited to 4,000 characters. Open customers close with one of seven seeded reasons; closing cancels open follow-ups and records the reason and actor. Reopening retains all history and cancelled work. All lifecycle timestamps are UTC and every mutation is mock-only and in memory.
