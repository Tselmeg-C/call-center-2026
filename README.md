# call-center-2026

Capstone project for AI Dev Zoomcamp 2026: a Sales customer-contact management application.

The mock prototype uses Next.js App Router, TypeScript and Ant Design in `apps/web`. No backend, database, secrets, or real account is needed.

## Local setup

Use Node.js 24 and its bundled npm. If you use nvm, run `nvm install` and `nvm use` from the repository root. No environment variables or credentials are required for this scaffold.

Run all commands from the repository root:

```sh
npm ci
npm run dev
```

Open http://localhost:3000. The app sends you to `/login`.

## Mock prototype

Select Alex Admin (Admin), River Sales (Sales), or Sky Sales (Sales), then Sign in. No password is requested. Admin lands on All Customers; Sales lands on Dashboard. Navigation destinations are explicitly labeled placeholders. Sales opening an Admin URL sees Access denied. The service-status panel shows synthetic demonstration records only, not customer data or workload calculations.

Mock controls are available on sign-in and application pages:

- Normal: sign-in and sample reads succeed.
- Loading: the next operation stays pending until you select Normal or reset. Controls remain usable while pending.
- Empty: sample reads return a no-data message.
- Error: the next sign-in or sample read fails once; Retry succeeds. Selecting Error again arms another failure.
- Expired session: clears the session and returns to sign-in with an expiry message. Sign in again to continue, or select Normal first.
- Reset mock state: restores original fixtures, clears scenarios/errors, signs out, and returns to sign-in.

Session and fixture state live only in memory, survive navigation, and reset on a full browser reload. Separate tabs have independent mock state. Logout, expiry, and reset invalidate pending requests; no durable browser storage is used. Mock role guards demonstrate behavior and are not a production security boundary.

Typed asynchronous application services live in `apps/web/services/types.ts`. The resettable mock adapter is `apps/web/services/mock.ts`; select or replace the adapter at the single composition point in `apps/web/services/provider.tsx`. UI components consume service interfaces, while scenario/reset controls use a separate mock-only interface. Full business screens and production authentication follow in later backlog tasks.

Customer browsing decisions and display rules are documented in [`_docs/customer-browsing.md`](_docs/customer-browsing.md).
Interaction and note permissions, validation, idempotency, and soft deletion are documented in [`_docs/interactions.md`](_docs/interactions.md).

## Checks

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

Vitest and React Testing Library cover sign-in/logout, route restrictions, retry, reset, deterministic fixtures, and stale responses after session removal. For watch mode, run `npm run test:watch --workspace @call-center/web`.

GitHub Actions runs installation, linting, type checking, the test, and a production build on pushes and pull requests. Type checking generates Next.js route types first, so it also works on a fresh checkout.

## Production build locally

```sh
npm run build
npm start
```

Open http://localhost:3000. The root npm workspace scripts delegate to `apps/web`; dependencies are locked in the root `package-lock.json`.
