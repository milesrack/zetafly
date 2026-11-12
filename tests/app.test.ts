import assert from "node:assert/strict";
import { createServer } from "node:http";
import test, { type TestContext } from "node:test";
import { type AppDependencies, createApp } from "../server/app.ts";
import { readConfig } from "../server/config.ts";

async function fixture(t: TestContext, authenticated = true) {
  const database = {
    findQuery: undefined as unknown,
    findProjection: undefined as unknown,
    findOneProjection: undefined as unknown,
    countQuery: undefined as unknown,
    skip: -1,
    limit: -1,
  };

  const dependencies = {
    config: readConfig({}),
    db: {
      command: async () => ({ ok: 1 }),
      collection: () => ({
        findOne: async (
          _query: unknown,
          options?: { projection?: unknown },
        ) => {
          database.findOneProjection = options?.projection;
          return null;
        },
        countDocuments: async (query: unknown) => {
          database.countQuery = query;
          return 0;
        },

        find: (query: unknown, options?: { projection?: unknown }) => {
          database.findQuery = query;
          database.findProjection = options?.projection;

          return {
            sort: () => ({
              skip: (offset: number) => {
                database.skip = offset;

                return {
                  limit: (limit: number) => {
                    database.limit = limit;

                    return {
                      toArray: async () => [],
                    };
                  },
                };
              },
            }),
          };
        },
      }),
    },
    auth: {
      handler: async () => Response.json({ ok: true }),
      api: { getSession: async () => null },
    },
    weights: {},
    sessions: { current: null },
    identify: async () =>
      authenticated
        ? { user: { id: "alice" }, session: { id: "session-a" } }
        : null,
    disconnectSession: () => {},
  } as unknown as AppDependencies;
  const app = createApp(dependencies);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const request = (path: string, init?: RequestInit) =>
    fetch(`http://127.0.0.1:${address.port}${path}`, init);

  return { request, dependencies, database };
}

test("public health works without credentials while private routes reject anonymous requests", async (t) => {
  const { request } = await fixture(t, false);
  const health = await request("/api/health");
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });
  const runs = await request("/api/runs");
  assert.equal(runs.status, 401);
  assert.deepEqual(await runs.json(), { error: "Log in to use Zetafly" });
});

test("feature routes retain origin rejection, owner filtering and JSON errors", async (t) => {
  const { request } = await fixture(t);
  const rejected = await request("/api/runs", {
    headers: { Origin: "https://other.example" },
  });
  assert.equal(rejected.status, 403);
  const runs = await request("/api/runs");
  assert.equal(runs.status, 200);
  assert.deepEqual(await runs.json(), []);
  const invalid = await request("/api/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ duration: 1 }),
  });
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: "Invalid session duration" });
  const missing = await request("/api/unknown");
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "Unknown endpoint" });
});

test("run history supports owner-scoped search and pagination", async (t) => {
  const { request, database } = await fixture(t);

  const response = await request("/api/runs?q=completed.*&page=3&limit=5");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);

  const pattern = "completed\\.\\*";

  assert.deepEqual(database.findQuery, {
    ownerId: "alice",
    $or: [
      { id: { $regex: pattern, $options: "i" } },
      { "profile.name": { $regex: pattern, $options: "i" } },
      { status: { $regex: pattern, $options: "i" } },
    ],
  });

  assert.deepEqual(database.findQuery, {
    ownerId: "alice",
    $or: [
      { id: { $regex: pattern, $options: "i" } },
      { "profile.name": { $regex: pattern, $options: "i" } },
      { status: { $regex: pattern, $options: "i" } },
    ],
  });

  assert.deepEqual(database.countQuery, database.findQuery);
  assert.equal(database.skip, 10);
  assert.equal(database.limit, 5);

  assert.equal(response.headers.get("x-page"), "3");
  assert.equal(response.headers.get("x-page-size"), "5");
  assert.equal(response.headers.get("x-total-count"), "0");
});

test("run detail excludes internal database fields", async (t) => {
  const { request, database } = await fixture(t);

  const response = await request("/api/runs/test-run");

  assert.equal(response.status, 404);

  assert.deepEqual(database.findOneProjection, {
    _id: 0,
    ownerId: 0,
    "profile.arithmeticMode": 0,
  });
});

test("run history rejects invalid search and pagination", async (t) => {
  const { request } = await fixture(t);

  const badPage = await request("/api/runs?page=0");
  assert.equal(badPage.status, 400);
  assert.deepEqual(await badPage.json(), { error: "Invalid pagination" });

  const badLimit = await request("/api/runs?limit=51");
  assert.equal(badLimit.status, 400);
  assert.deepEqual(await badLimit.json(), { error: "Invalid pagination" });

  const longSearch = await request(`/api/runs?q=${"a".repeat(101)}`);
  assert.equal(longSearch.status, 400);
  assert.deepEqual(await longSearch.json(), {
    error: "Search must be text up to 100 characters",
  });
});

test("weight deletion refuses an active owner's session before touching storage", async (t) => {
  const { request, dependencies } = await fixture(t);
  dependencies.sessions.current = {
    ownerId: "alice",
    session: { running: true },
    profileId: "profile",
  } as NonNullable<typeof dependencies.sessions.current>;
  const response = await request("/api/weights/profile", { method: "DELETE" });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "Stop the run before removing weights",
  });
});

for (const status of [200, 500]) {
  test(`sign-out preserves the raw auth request and invalidates live access only on success (${status})`, async (t) => {
    const { request, dependencies } = await fixture(t, false);
    const disconnected: string[] = [];
    const stopped: string[] = [];
    dependencies.auth.api.getSession = (async () => ({
      user: { id: "alice" },
      session: { id: "session-a" },
    })) as typeof dependencies.auth.api.getSession;
    dependencies.auth.handler = async (req) =>
      Response.json({ raw: await req.text() }, { status });
    dependencies.disconnectSession = (id) => {
      disconnected.push(id);
    };
    dependencies.sessions.stop = async (id) => {
      stopped.push(id);
    };
    // The app captures this callback when constructed.
    const app = createApp(dependencies);
    const server = createServer(app);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    t.after(() => {
      server.closeAllConnections();
      server.close();
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/auth/sign-out`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "raw-auth-body",
      },
    );
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { raw: "raw-auth-body" });
    assert.match(response.headers.get("set-cookie") ?? "", /zetafly_access=;/);
    assert.deepEqual(disconnected, status === 200 ? ["session-a"] : []);
    assert.deepEqual(stopped, status === 200 ? ["alice"] : []);
    // The separately constructed app does not require another database connection.
    assert.equal((await request("/api/health")).status, 200);
  });
}
