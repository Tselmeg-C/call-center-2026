# Sales API contract

The OpenAPI 3.1 source is [`packages/shared/openapi.yaml`](../packages/shared/openapi.yaml), with the service mapping in [`packages/shared/service-map.md`](../packages/shared/service-map.md). IDs, BCNs, and timestamps are strings; dates are `YYYY-MM-DD`; nullable values are explicit. Lists use `page` (default 1) and `page_size` (default 25, maximum 100). Errors expose a safe code, message, request ID, and optional field errors. Mock lifetime is in memory; durable idempotency records belong to the persistence work.

Synthetic valid and error payloads live in [`packages/shared/contract-fixtures.json`](../packages/shared/contract-fixtures.json). Run `node packages/shared/validate-openapi.mjs` to check required operations and fixture invariants.

Production sessions use an opaque `HttpOnly` cookie with `SameSite=Lax`, `Path=/`, and `Secure` outside localhost development. Sessions expire absolutely after eight hours; logout, expiry, password reset, deactivation, and role changes revoke them. Unsafe authenticated requests require an allowed `Origin` (or same-origin `Referer` fallback); credentialed CORS uses exact frontend origins. Examples and logs never contain passwords or session values.
