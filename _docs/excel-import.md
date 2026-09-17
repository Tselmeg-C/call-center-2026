# Excel import

The Admin upload accepts one `.xlsx` file up to 10 MiB. The API parses the first worksheet, ignores extra sheets, trims headers, and matches them case-insensitively regardless of order. It limits processing to 10,000 nonblank rows and 100 MiB of expanded cell content. Fully blank rows are ignored; invalid rows do not mutate customers. Valid rows, phones, typed source fields, job totals, and row errors commit together in PostgreSQL, and a failed persistence attempt leaves a safe failed-job record.

Imported fields are source attributes: `bcn` (required text, max 128), `customer_name` (required text, max 255), phone (nullable text, max 64), booleans `previously_contacted` and `recent`, integer `propensity_rank`, decimal `propensity_score`, revenue/FEM amounts, dates, and nullable sales fields. Vendor/category pairs are stored in an extensible child collection. Blank nullable cells clear their imported value. Ownership, lifecycle, interactions, notes, follow-ups, and non-primary phones are preserved. Reusing an actor/submission ID returns the original result; changing its workbook returns `409`.

## Upload input rules (API)

- The `submission_id` query parameter is required: 1-120 characters with at least one non-whitespace character. Otherwise the request returns `422 {"detail": "Invalid request."}` before the file is read or any job is stored.
- The uploaded filename is at most 255 characters (`422 {"detail": "Invalid request."}` otherwise) and must end in `.xlsx` (`422 "Upload an .xlsx workbook."` otherwise).
- Oversized uploads (10 MiB), expanded content (100 MiB) and row counts (10,000) return `413`.
