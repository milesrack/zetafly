import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { MongoClient, ObjectId } from "mongodb";
import { accessVerifier } from "../server/access.ts";
import { createApp } from "../server/app.ts";
import { createAuth } from "../server/auth.ts";
import { readConfig } from "../server/config.ts";
import { prepareDatabase } from "../server/database.ts";
import { OwnerOperations } from "../server/owner-operations.ts";
import { DEFAULTS } from "../server/settings.ts";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));

const { SessionManager } = await import("../server/session-manager.ts");
const { Weights } = await import("../server/weights.ts");

if (process.env.RESEND_API_KEY || process.env.PUBLIC_DEPLOYMENT === "true") {
  throw Error("Run history checks only with local MongoDB");
}

const mongo = new MongoClient(
  process.env.MONGODB_URI?.trim() || "mongodb://127.0.0.1:27017",
);

await mongo.connect();

const db = mongo.db(`zetafly_run_history_${randomBytes(8).toString("hex")}`);

const config = readConfig();
const password = randomBytes(24).toString("base64url");
const weights = new Weights(db);
const auth = createAuth(db);
const identify = accessVerifier(auth, db);
const operations = new OwnerOperations();
const sessions = new SessionManager(db, () => {}, weights);

const app = createApp({
  db,
  auth,
  weights,
  sessions,
  identify,
  config,
  disconnectSession: () => {},
  operations,
});

const server = createServer(app);

const originalFetch = globalThis.fetch;

globalThis.fetch = (url, options) =>
  String(url).startsWith("https://api.pwnedpasswords.com/range/")
    ? Promise.resolve(new Response(`${"0".repeat(35)}:0`))
    : originalFetch(url, options);

try {
  await prepareDatabase(db);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const base = `http://127.0.0.1:${address.port}`;

  function client() {
    const cookies = new Map<string, string>();

    return {
      async send(path: string, method = "GET", body?: unknown) {
        const response = await fetch(base + path, {
          method,
          headers: {
            Origin: config.origin,
            Cookie: [...cookies]
              .map(([key, value]) => `${key}=${value}`)
              .join("; "),
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });

        for (const cookie of response.headers.getSetCookie()) {
          const pair = cookie.split(";")[0];
          const index = pair.indexOf("=");

          if (pair.slice(index + 1)) {
            cookies.set(pair.slice(0, index), pair.slice(index + 1));
          } else {
            cookies.delete(pair.slice(0, index));
          }
        }

        return response;
      },
    };
  }

  async function createAccount(label: string) {
    const instance = client();
    const email = `run-history-${label}-${randomBytes(6).toString("hex")}@example.test`;

    const signup = await instance.send("/api/auth/sign-up/email", "POST", {
      name: `Run History ${label}`,
      email,
      password,
    });

    assert.equal(signup.status, 200);

    const { user } = (await signup.json()) as {
      user: { id: string };
    };

    await db
      .collection("user")
      .updateOne(
        { _id: new ObjectId(user.id) },
        { $set: { emailVerified: true } },
      );

    const signin = await instance.send("/api/auth/sign-in/email", "POST", {
      email,
      password,
    });

    assert.equal(signin.status, 200);

    const access = await instance.send("/api/access", "POST");

    assert.equal(access.status, 200);

    return {
      client: instance,
      userId: user.id,
    };
  }

  const alice = await createAccount("alice");
  const bob = await createAccount("bob");

  function run(
    id: string,
    ownerId: string,
    profileName: string,
    status: string,
    startedAt: string,
  ) {
    return {
      id,
      ownerId,
      profile: {
        id: "published",
        name: profileName,
        features: 10,
        synaptic: true,
        sha256: "a".repeat(64),
      },
      startedAt: new Date(startedAt),
      finishedAt: new Date(startedAt),
      status,
      attempts: 10,
      accepted: 8,
      protocol: "model-policy-v3",
      settings: DEFAULTS,
      events: [{ kind: "fixture" }],
    };
  }

  await db
    .collection("runs")
    .insertMany([
      run(
        "alice-newest",
        alice.userId,
        "Training Alpha",
        "completed",
        "2026-01-06T12:00:00Z",
      ),
      run(
        "alice-second",
        alice.userId,
        "Training Beta",
        "completed",
        "2026-01-05T12:00:00Z",
      ),
      run(
        "alice-literal.*",
        alice.userId,
        "Draft [v2].*",
        "stopped",
        "2026-01-04T12:00:00Z",
      ),
      run(
        "alice-error",
        alice.userId,
        "Fallback",
        "error",
        "2026-01-03T12:00:00Z",
      ),
      run(
        "alice-older",
        alice.userId,
        "Other",
        "completed",
        "2026-01-02T12:00:00Z",
      ),
      run(
        "alice-oldest",
        alice.userId,
        "Other",
        "stopped",
        "2026-01-01T12:00:00Z",
      ),
      run(
        "bob-private",
        bob.userId,
        "Training Private",
        "completed",
        "2026-01-07T12:00:00Z",
      ),
    ]);

  //pagination tests
  async function testPage(page: number, ids: string[]) {
    const response = await alice.client.send(`/api/runs?page=${page}&limit=2`,);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-total-count"), "6");
    assert.equal(response.headers.get("x-page"), String(page));
    assert.equal(response.headers.get("x-page-size"), "2");

    const responseRuns = (await response.json()) as { id: string }[];

    assert.deepEqual(responseRuns.map((run) => run.id), ids,);
  }

  await testPage(1, ["alice-newest", "alice-second"]);

  await testPage(2, ["alice-literal.*", "alice-error"]);

  await testPage(3, ["alice-older", "alice-oldest"]);

  //search behavior tests
  async function testSearch(query: string, ids: string[]) {
    const response = await alice.client.send(`api/runs?q=${encodeURIComponent(query)}`,);

    assert.equal(response.status, 200);

    const responseRuns = (await response.json()) as {id: string}[];

    assert.deepEqual(responseRuns.map((run) => run.id), ids,);
  }

  await testSearch("alice-error", ["alice-error"]);

  await testSearch("Training", ["alice-newest", "alice-second"]);

  await testSearch("stopped", ["alice-literal.*", "alice-oldest"]);

  await testSearch(".*", ["alice-literal.*"]);

  console.log("Run history test data created");
} finally {
  await sessions.close();
  server.closeAllConnections();

  await new Promise<void>((resolve) => server.close(() => resolve()));

  globalThis.fetch = originalFetch;

  await db.dropDatabase();
  await mongo.close();
}
