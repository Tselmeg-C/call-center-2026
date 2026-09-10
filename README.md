# call-center-2026

Capstone project for AI Dev Zoomcamp 2026: a Sales customer-contact management application.

The initial scaffold contains a Next.js App Router frontend with TypeScript and Ant Design in `apps/web`. It displays a placeholder page; backend and database functionality will be added in later tasks.

## Local setup

Use Node.js 24 and its bundled npm. If you use nvm, run `nvm install` and `nvm use` from the repository root. No environment variables or credentials are required for this scaffold.

Run all commands from the repository root:

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Edit `apps/web/app/page.tsx` to update the landing page.

## Checks

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

The smoke test renders the actual landing page, including Ant Design components, and checks its visible heading and content. Vitest uses jsdom and React Testing Library. For watch mode, run `npm run test:watch --workspace @call-center/web`.

GitHub Actions runs installation, linting, type checking, the test, and a production build on pushes and pull requests. Type checking generates Next.js route types first, so it also works on a fresh checkout.

## Production build locally

```sh
npm run build
npm start
```

Open http://localhost:3000. The root npm workspace scripts delegate to `apps/web`; dependencies are locked in the root `package-lock.json`.
