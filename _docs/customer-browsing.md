# Customer browsing

The prototype keeps `bcn` as an immutable string, so leading zeros and duplicate names remain distinct. Customer lists default to `bcn` ascending, show 25 rows, and filter the signed-in Sales user's assignments for My Customers. All Customers includes unassigned records. Search trims input, ignores phone punctuation, and matches name, `bcn`, `MBCN`, or phone values. Missing source values render as an em dash.

Customer source fields are separate from operational history. Imported `previously_contacted` is displayed as source information and does not create an application interaction. Detail history is newest first and read-only in this issue; mutations arrive in later backlog items.
