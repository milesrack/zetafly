import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { APIError } from "better-auth/api";
import { GridFSBucket, MongoClient, ObjectId } from "mongodb";
import WebSocket from "ws";
import { accessVerifier } from "../server/access.ts";
import { createApp } from "../server/app.ts";
import { createAuth } from "../server/auth.ts";
import { readConfig } from "../server/config.ts";
import { prepareDatabase } from "../server/database.ts";
import { LiveConnections } from "../server/live.ts";
import { OwnerOperations } from "../server/owner-operations.ts";
import type { Session } from "../server/session.ts";
import { DEFAULTS } from "../server/settings.ts";

// The Docker fixture is piped through stdin from /app/server.
process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const { SessionManager } = await import("../server/session-manager.ts");
const { Weights } = await import("../server/weights.ts");

if (process.env.RESEND_API_KEY || process.env.PUBLIC_DEPLOYMENT === "true") {
  throw Error(
    "Run account deletion checks only with local MongoDB and Mailpit",
  );
}

const mongo = new MongoClient(
  process.env.MONGODB_URI?.trim() || "mongodb://127.0.0.1:27017",
);
await mongo.connect();
const db = mongo.db(`zetafly_deletion_${randomBytes(8).toString("hex")}`);
const config = readConfig();
const password = randomBytes(24).toString("base64url");
const weights = new Weights(db);
const stopping = Promise.withResolvers<void>();
const finishCleanup = Promise.withResolvers<void>();
let rejectCleanup = false;
const auth = createAuth(db, async (ownerId) => {
  if (rejectCleanup) {
    throw new APIError("CONFLICT", { message: "Try again" });
  }

  await sessions.remove(ownerId);
  live.disconnectOwner(ownerId);
  stopping.resolve();
  await finishCleanup.promise;
});
const identify = accessVerifier(auth, db);
const operations = new OwnerOperations();
const live = new LiveConnections(identify, config.origins, operations);
const sessions = new SessionManager(db, () => {}, weights);
const app = createApp({
  db,
  auth,
  weights,
  sessions,
  identify,
  config,
  disconnectSession: (id) => live.disconnectSession(id),
  operations,
});
const server = createServer(app);
live.attach(server, sessions);
const sockets: WebSocket[] = [];
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
      cookies,
      cookie: () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
      async send(
        path: string,
        method = "GET",
        body?: unknown,
        origin = config.origin,
      ) {
        const response = await fetch(base + path, {
          method,
          headers: {
            Origin: origin,
            Cookie: this.cookie(),
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

  const alice = client();
  const aliceOther = client();
  const bob = client();
  const suffix = randomBytes(6).toString("hex");
  const email = `delete-${suffix}@example.test`;
  const bobEmail = `keep-${suffix}@example.test`;
  async function signup(instance: ReturnType<typeof client>, email: string) {
    const response = await instance.send("/api/auth/sign-up/email", "POST", {
      name: "Deletion QA",
      email,
      password,
    });
    assert.equal(response.status, 200);
    const { user } = await response.json();
    await db
      .collection("user")
      .updateOne(
        { _id: new ObjectId(user.id) },
        { $set: { emailVerified: true } },
      );
    return user.id as string;
  }
  const aliceId = await signup(alice, email);
  const bobId = await signup(bob, bobEmail);
  for (const [instance, address] of [
    [alice, email],
    [aliceOther, email],
    [bob, bobEmail],
  ] as const) {
    assert.equal(
      (
        await instance.send("/api/auth/sign-in/email", "POST", {
          email: address,
          password,
        })
      ).status,
      200,
    );
    assert.equal((await instance.send("/api/access", "POST")).status, 200);
  }
  const previousToken = decodeURIComponent(
    alice.cookies.get("zetafly_access")!,
  );
  for (const body of [
    {},
    { password: "incorrect" },
    { password, token: "bypass" },
  ]) {
    const response = await alice.send("/api/auth/delete-user", "POST", body);
    assert.equal(response.status, 400);
    assert.ok(
      alice.cookies.has("zetafly_access"),
      "Failed deletion cleared API access",
    );
    assert.ok(
      await db.collection("user").findOne({ _id: new ObjectId(aliceId) }),
    );
  }
  assert.equal(
    (
      await alice.send(
        "/api/auth/delete-user",
        "POST",
        { password },
        "https://evil.example",
      )
    ).status,
    403,
  );
  // The following cleanup failure is exercised directly so it has its own limiter key.
  rejectCleanup = true;
  await assert.rejects(
    auth.api.deleteUser({
      headers: new Headers({ cookie: alice.cookie() }),
      body: { password },
    }),
  );
  rejectCleanup = false;
  assert.equal(
    await db.collection("user").countDocuments({ _id: new ObjectId(aliceId) }),
    1,
  );

  const bucket = new GridFSBucket(db, { bucketName: "weights" });
  const files = new Map<string, ObjectId>();
  for (const ownerId of [aliceId, bobId]) {
    const upload = bucket.openUploadStream("fixture.npz", {
      metadata: ownerId === aliceId ? {} : { ownerId },
    });
    const stored = once(upload, "finish");
    upload.end(Buffer.alloc(300000, 7));
    await stored;
    files.set(ownerId, upload.id);
    await db
      .collection("weightProfiles")
      .insertOne({ id: `profile-${ownerId}`, ownerId, fileId: upload.id });
    await db
      .collection("preferences")
      .insertOne({ ownerId, settings: DEFAULTS });
    await db.collection("runs").insertOne({ id: `run-${ownerId}`, ownerId });
    await db
      .collection("verification")
      .insertOne({ identifier: `reset-password:${ownerId}`, value: ownerId });
  }
  const orphan = bucket.openUploadStream("orphan.npz", {
    metadata: { ownerId: aliceId },
  });
  const orphanStored = once(orphan, "finish");
  orphan.end(Buffer.from("unreferenced uploaded data"));
  await orphanStored;

  for (const instance of [alice, aliceOther, bob]) {
    const socket = new WebSocket(`${base.replace("http", "ws")}/live`, {
      origin: config.origin,
      headers: { Cookie: instance.cookie() },
    });
    sockets.push(socket);
    await once(socket, "message");
  }
  const closed = sockets.slice(0, 2).map((socket) => once(socket, "close"));
  sessions.current = {
    ownerId: aliceId,
    profileId: null,
    session: {
      close: async () => {
        await db
          .collection("runs")
          .insertOne({ id: "final-write", ownerId: aliceId });
      },
    } as unknown as Session,
  };
  const writing = Promise.withResolvers<void>();
  const finishWrite = Promise.withResolvers<void>();
  const getWeights = weights.get.bind(weights);
  weights.get = async (ownerId, id) => {
    if (ownerId === aliceId) {
      writing.resolve();
      await finishWrite.promise;
    }
    return getWeights(ownerId, id);
  };
  const write = alice.send("/api/preferences", "PUT", DEFAULTS);
  await writing.promise;
  const deletion = aliceOther.send("/api/auth/delete-user", "POST", {
    password,
  });
  finishWrite.resolve();
  assert.equal((await write).status, 200);
  await stopping.promise;
  // This request authenticates while deletion is waiting, then must reauthenticate in the queue.
  const staleWrite = alice.send("/api/preferences", "PUT", DEFAULTS);
  const lateSocket = new WebSocket(`${base.replace("http", "ws")}/live`, {
    origin: config.origin,
    headers: { Cookie: alice.cookie() },
  });
  sockets.push(lateSocket);
  const rejectedHandshake = assert.rejects(
    once(lateSocket, "open"),
    /socket hang up/,
  );
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
  finishCleanup.resolve();
  const deleted = await deletion;
  assert.equal(deleted.status, 200, await deleted.clone().text());
  assert.deepEqual(await deleted.json(), {
    success: true,
    message: "User deleted",
  });
  assert.equal((await staleWrite).status, 401);
  await Promise.all(closed);
  await rejectedHandshake;
  assert.equal(sockets[2].readyState, WebSocket.OPEN);
  assert.equal(sessions.current, null);
  assert.match(deleted.headers.getSetCookie().join(";"), /zetafly_access=;/);
  for (const name of ["user", "account", "session"]) {
    const query =
      name === "user"
        ? { _id: new ObjectId(aliceId) }
        : { userId: new ObjectId(aliceId) };
    assert.equal(
      await db.collection(name).countDocuments(query),
      0,
      `${name} retained deleted identity`,
    );
  }
  for (const name of ["runs", "preferences", "weightProfiles"]) {
    assert.equal(
      await db.collection(name).countDocuments({ ownerId: aliceId }),
      0,
      name,
    );
    assert.equal(
      await db.collection(name).countDocuments({ ownerId: bobId }),
      1,
      `Other owner's ${name} removed`,
    );
  }
  assert.equal(
    await db.collection("verification").countDocuments({ value: aliceId }),
    0,
  );
  assert.equal(
    await db
      .collection("weights.files")
      .countDocuments({ "metadata.ownerId": aliceId }),
    0,
  );
  assert.equal(
    await db
      .collection("weights.chunks")
      .countDocuments({ files_id: files.get(aliceId) }),
    0,
  );
  assert.equal(
    await db
      .collection("weights.chunks")
      .countDocuments({ files_id: files.get(bobId) }),
    2,
  );
  assert.equal(
    await db
      .collection("weights.files")
      .countDocuments({ _id: files.get(aliceId) }),
    0,
    "A legacy file without owner metadata survived deletion",
  );
  assert.equal(
    await db
      .collection("weights.chunks")
      .countDocuments({ files_id: orphan.id }),
    0,
    "An owned file without a profile survived deletion",
  );
  assert.equal((await alice.send("/api/access", "POST")).status, 401);
  assert.equal((await aliceOther.send("/api/access", "POST")).status, 401);
  assert.equal(
    (
      await fetch(`${base}/api/preferences`, {
        headers: { Authorization: `Bearer ${previousToken}` },
      })
    ).status,
    401,
  );
  assert.equal((await bob.send("/api/preferences")).status, 200);
  assert.equal(
    (await alice.send("/api/auth/sign-in/email", "POST", { email, password }))
      .status,
    401,
  );
  console.log(
    "Account deletion passed: password/CSRF checks, queued writes, final run cleanup, GridFS, owner isolation, all sessions/JWTs/live connections revoked",
  );
} finally {
  finishCleanup.resolve();
  for (const socket of sockets) {
    socket.terminate();
  }
  live.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  globalThis.fetch = originalFetch;
  await db.dropDatabase();
  await mongo.close();
}
