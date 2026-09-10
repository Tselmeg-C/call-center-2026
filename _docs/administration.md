# Administration

Admins manage synthetic users and closure reasons from the settings routes. Names and emails are trimmed and validated; email and reason labels are case-insensitively unique across inactive records. Users are deactivated rather than deleted. Deactivating or promoting Sales releases their open customers to Unassigned while preserving closed ownership and history. An active Admin is always required, and the current session cannot demote or deactivate itself.

Closure history stores the label snapshot at close time. Settings changes therefore do not rewrite past customer history.
