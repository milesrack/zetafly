import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import test from "node:test";
import type { Response } from "express";
import { MongoRuntimeError } from "mongodb";
import { Weights } from "../server/weights.ts";

const rows = [
  {
    id: "one",
    ownerId: "alice",
    name: "Training v2",
    checkpointFormat: "sequence-npz-v1",
  },
  {
    id: "two",
    ownerId: "alice",
    name: "Retrained addition",
    checkpointFormat: "sequence-npz-v1",
  },
  {
    id: "three",
    ownerId: "alice",
    name: "Draft [v2].*",
    checkpointFormat: "sequence-npz-v1",
  },
  {
    id: "secret",
    ownerId: "bob",
    name: "Training private",
    checkpointFormat: "sequence-npz-v1",
  },
  {
    id: "legacy",
    ownerId: "alice",
    name: "Training archived",
    checkpointFormat: undefined,
  },
];

function fixture() {
  const weights = Object.create(Weights.prototype) as Weights;

  weights.collection = {
    find(query: {
      ownerId: string;
      checkpointFormat: string;
      name?: { $regex: string; $options: string };
    }) {
      assert.equal(query.ownerId, "alice");
      assert.equal(query.checkpointFormat, "sequence-npz-v1");

      const pattern = query.name
        ? new RegExp(query.name.$regex, query.name.$options)
        : null;

      return {
        sort: () => ({
          toArray: async () =>
            rows.filter(
              (row) =>
                row.ownerId === query.ownerId &&
                row.checkpointFormat === query.checkpointFormat &&
                (!pattern || pattern.test(row.name)),
            ),
        }),
      };
    },
  } as unknown as Weights["collection"];

  return weights;
}

test("weight search matches partial names case-insensitively within the current owner", async () => {
  const result = await fixture().list("alice", " TrAiN ");

  assert.deepEqual(
    result.map((row) => row.id),
    ["one", "two"],
  );
});

test("weight search treats regex punctuation as literal text", async () => {
  for (const query of ["[v2]", ".*"]) {
    assert.deepEqual(
      (await fixture().list("alice", query)).map((row) => row.id),
      ["three"],
    );
  }

  assert.deepEqual(await fixture().list("alice", "^"), []);
});

test("default profile matches search on the server and empty queries return all own profiles", async () => {
  assert.deepEqual(
    (await fixture().list("alice", "def")).map((row) => row.id),
    ["published"],
  );

  assert.equal((await fixture().list("alice", " ")).length, 4);
  assert.deepEqual(await fixture().list("alice", "no-such-profile"), []);
});

test("weight search rejects oversized and non-string query parameters", async () => {
  for (const query of ["x".repeat(101), ["a", "b"], { $ne: "" }]) {
    await assert.rejects(
      fixture().list("alice", query),
      (error) =>
        error instanceof Error && "status" in error && error.status === 400,
    );
  }
});

test("archived uploads remain retrievable but cannot be materialised", async () => {
  const weights = Object.create(Weights.prototype) as Weights;
  const archived = {
    id: "legacy",
    ownerId: "alice",
    fileId: "archived",
    extension: ".zip",
    bundleVersion: 2,
  };

  weights.collection = {
    findOne: async (query: { ownerId: string; id: string }) =>
      query.ownerId === "alice" && query.id === "legacy" ? archived : null,
  } as unknown as Weights["collection"];

  assert.equal(await weights.get("alice", "legacy"), archived);

  await assert.rejects(
    weights.materialise("alice", "legacy"),
    /supported sequence brain/,
  );

  await assert.rejects(
    weights.get("bob", "legacy"),
    (error) =>
      error instanceof Error && "status" in error && error.status === 404,
  );
});

test("archived ZIP bytes retain their download filename", async () => {
  const weights = Object.create(Weights.prototype) as Weights;
  const bytes = Buffer.from("archived executable bundle");
  const profile = {
    id: "legacy",
    name: "Archived",
    extension: ".zip",
    fileId: "archived",
  };

  weights.bucket = {
    openDownloadStream: (id: string) => {
      assert.equal(id, "archived");

      return Readable.from([bytes]);
    },
  } as unknown as Weights["bucket"];

  const received: Buffer[] = [];
  const response = Object.assign(
    new Writable({
      write(chunk, _encoding, done) {
        received.push(chunk);
        done();
      },
    }),
    {
      type(value: string) {
        assert.equal(value, "application/octet-stream");

        return this;
      },
      attachment(value: string) {
        assert.equal(value, "Archived.zip");

        return this;
      },
    },
  );

  await weights.download(
    profile as unknown as Parameters<Weights["download"]>[0],
    response as unknown as Response,
  );

  assert.deepEqual(Buffer.concat(received), bytes);
});

test("weight removal can finish after deleting the file on an earlier attempt", async () => {
  const weights = Object.create(Weights.prototype) as Weights;
  let fileExists = true;
  let profileExists = true;
  let profileDeleteAttempts = 0;
  const storageError = new Error("Storage unavailable");

  weights.collection = {
    findOne: async () => ({ fileId: "file" }),
    deleteOne: async () => {
      if (fileExists) {
        throw new Error("File must be removed first");
      }

      profileDeleteAttempts++;

      if (profileDeleteAttempts === 1) {
        throw storageError;
      }

      profileExists = false;
    },
  } as unknown as Weights["collection"];
  weights.bucket = {
    delete: async () => {
      if (!fileExists) {
        throw new MongoRuntimeError("File not found for id file");
      }

      fileExists = false;
    },
  } as unknown as Weights["bucket"];

  await assert.rejects(weights.remove("alice", "profile"), storageError);
  assert.equal(profileExists, true);
  await weights.remove("alice", "profile");
  assert.equal(profileExists, false);
});
