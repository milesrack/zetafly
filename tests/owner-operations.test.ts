import assert from "node:assert/strict";
import test from "node:test";
import { OwnerOperations } from "../server/owner-operations.ts";

test("account mutations wait for the same owner but not other owners", async () => {
  const operations = new OwnerOperations();
  const pending = Promise.withResolvers<void>();
  const events: string[] = [];
  const upload = operations.run("alice", async () => {
    events.push("upload");
    await pending.promise;
  });
  const deletion = operations.run("alice", async () => {
    events.push("delete");
  });

  await operations.run("bob", async () => {
    events.push("bob");
  });
  assert.deepEqual(events, ["upload", "bob"]);
  pending.resolve();
  await Promise.all([upload, deletion]);
  assert.deepEqual(events, ["upload", "bob", "delete"]);
});

test("a failed account operation releases the next request", async () => {
  const operations = new OwnerOperations();
  await assert.rejects(
    operations.run("alice", async () => {
      throw Error("database unavailable");
    }),
    /database unavailable/,
  );
  assert.equal(await operations.run("alice", async () => "retry"), "retry");
});
