import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import makeFetchCookie from "fetch-cookie";

/** Real-HTTP journey support: spawns the actual FastAPI backend (apps/api/main.py) with
 *  CALL_CENTER_STORAGE=memory as a child process on a free port, and tears it down afterwards.
 *  Every journey test talks to it over real HTTP via services/http.ts -- no mocked fetch, no
 *  ASGI test client. Requires apps/api's Python dependencies to already be installed (see
 *  apps/api/requirements.txt); npm run test:journey documents this in README.md. */

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(baseUrl: string, deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health/live`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Backend did not become healthy at ${baseUrl} in time.`);
}

export type TestBackend = { baseUrl: string; origin: string; stop: () => Promise<void> };

/** Node's global fetch (unlike a browser) has no cookie jar, so a fresh one per simulated actor
 *  (Admin, Sales, "anonymous", ...) keeps their sessions independent -- exactly what a real
 *  browser would give each of them. Passed as services/http.ts's `fetch` config. */
export function newActorFetch(): typeof fetch {
  return makeFetchCookie(fetch) as unknown as typeof fetch;
}

export async function startBackend(): Promise<TestBackend> {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  // The Origin doesn't need to be reachable -- the backend only string-compares it against
  // FRONTEND_ORIGIN (see apps/api/main.py's origin_guard) to satisfy the unsafe-method guard.
  const origin = "http://localhost:5173";
  const repoRoot = new URL("../../../../../", import.meta.url).pathname;
  const child: ChildProcess = spawn(
    "python3",
    ["-m", "uvicorn", "apps.api.main:app", "--host", "127.0.0.1", "--port", String(port), "--log-level", "warning"],
    {
      cwd: repoRoot,
      env: { ...process.env, CALL_CENTER_STORAGE: "memory", FRONTEND_ORIGIN: origin },
      stdio: "pipe",
    },
  );
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const exited = new Promise<never>((_, reject) => {
    child.on("exit", (code) => {
      if (code !== null && code !== 0) reject(new Error(`Backend process exited with code ${code}:\n${stderr}`));
    });
  });

  await Promise.race([waitForHealth(baseUrl, Date.now() + 15_000), exited]);

  return {
    baseUrl,
    origin,
    stop: () =>
      new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
      }),
  };
}
