# Interactions and notes

The mock customer workflow records two interaction outcomes: `Attempt` (no answer) and `Contact` (answered). Each interaction may include an optional note. Standalone notes require non-whitespace text. All note text is trimmed and limited to 4,000 characters; markup is rendered as text.

Only the current Sales owner or an Admin may create records. Closed customers remain readable and their history can be deleted under the same ownership rules, but they must be reopened before a new interaction or note is created. Each save has a submission ID, so a retry or double submission returns the original record; separate submission IDs create separate records.

Deletion is a soft operation. The original record remains in mock storage and its history entry becomes a tombstone with the deleting actor and UTC time. Deleted interaction outcomes and notes are hidden from ordinary content and deleted interactions do not affect contact status. The mock adapter uses an injectable clock for deterministic tests and synthetic data only.

These decisions are shared by [#5](https://github.com/Tselmeg-C/call-center-2026/issues/5), [#10](https://github.com/Tselmeg-C/call-center-2026/issues/10), [#11](https://github.com/Tselmeg-C/call-center-2026/issues/11), [#16](https://github.com/Tselmeg-C/call-center-2026/issues/16), and [#25](https://github.com/Tselmeg-C/call-center-2026/issues/25).
