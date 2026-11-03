import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { WebSocket } from "ws";
import { LiveConnections } from "../server/live.ts";
import type { SessionManager } from "../server/session-manager.ts";

test("live connections reject invalid handshakes and isolate owner broadcasts and sign-out", async (t) => {
  const live = new LiveConnections(
    async (req) => {
      const id = req.headers.authorization;
      return id ? { user: { id }, session: { id: `${id}-session` } } : null;
    },
    ["http://localhost:3000"],
  );
  const sessions = {
    current: null,
    state: () => ({
      status: "idle",
      keys: [],
      frame: null,
      trial: null,
      attempts: 0,
      accepted: 0,
    }),
  } as unknown as SessionManager;
  const server = createServer();
  live.attach(server, sessions);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const clients: WebSocket[] = [];
  t.after(() => {
    for (const client of clients) {
      client.terminate();
    }
    live.close();
    server.close();
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const connect = (
    id: string,
    origin = "http://localhost:3000",
    path = "/live",
  ) => {
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}${path}`, {
      origin,
      headers: { authorization: id },
    });
    clients.push(socket);
    return socket;
  };
  for (const socket of [
    connect("alice", "https://other.example"),
    connect(""),
    connect("alice", undefined, "/other"),
  ]) {
    await assert.rejects(once(socket, "open"), /socket hang up/);
  }
  const alice = connect("alice");
  const bob = connect("bob");
  const aliceState = once(alice, "message");
  const bobState = once(bob, "message");
  const [initial] = await aliceState;
  await bobState;
  assert.equal(JSON.parse(String(initial)).status, "idle");
  const aliceMessage = once(alice, "message");
  const bobMessage = once(bob, "message");
  live.broadcast("alice", { kind: "screen", png: "alice-only" });
  live.broadcast("bob", { kind: "screen", png: "bob-only" });
  assert.deepEqual(JSON.parse(String((await aliceMessage)[0])), {
    kind: "screen",
    png: "alice-only",
  });
  assert.deepEqual(JSON.parse(String((await bobMessage)[0])), {
    kind: "screen",
    png: "bob-only",
  });
  const aliceOther = connect("alice");
  await once(aliceOther, "message");
  const closedOther = once(aliceOther, "close");
  const closed = once(alice, "close");
  live.disconnectOwner("alice");
  assert.equal((await closedOther)[0], 1000);
  live.disconnectSession("alice-session");
  assert.equal((await closed)[0], 1000);
  assert.equal(bob.readyState, WebSocket.OPEN);
});
