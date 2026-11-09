import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import type { Request } from "express";
import { ObjectId } from "mongodb";
import { Weights } from "../server/weights.ts";

function fixture() {
  const weights = Object.create(Weights.prototype) as Weights;
  weights.receiving = new Set();
  weights.validating = false;
  const stored: unknown[] = [];

  weights.collection = {
    countDocuments: async () => 0,
    insertOne: async (profile: unknown) => stored.push(profile),
  } as unknown as Weights["collection"];

  weights.bucket = {
    openUploadStream: () =>
      Object.assign(
        new Writable({
          write(_chunk, _encoding, done) {
            done();
          },
        }),
        { id: new ObjectId() },
      ),
    delete: async () => {},
  } as unknown as Weights["bucket"];

  return { weights, stored };
}

function request() {
  return Object.assign(new PassThrough(), { get: () => "weights.npz" });
}

const status = (code: number) => (error: unknown) =>
  error instanceof Error && "status" in error && error.status === code;

async function receiving(stream: PassThrough) {
  for (let i = 0; i < 200 && stream.listenerCount("data") === 0; i++) {
    await setImmediate();
  }

  assert.ok(
    stream.listenerCount("data") > 0,
    "body reception must have started",
  );
}

test("uploads accept numeric NPZ checkpoints and reject executable ZIP bundles", async () => {
  const { weights, stored } = fixture();
  const bytes = await readFile("models/default/weights.npz");
  const executable = Object.assign(request(), { get: () => "weights.zip" });
  executable.end(bytes);

  await assert.rejects(
    weights.upload(executable as unknown as Request, "alice"),
    /NPZ weights checkpoint/,
  );

  const checkpoint = request();
  checkpoint.end(bytes);

  await weights.upload(checkpoint as unknown as Request, "alice");

  assert.equal(stored.length, 1);

  assert.equal(
    (stored[0] as { checkpointFormat: string }).checkpointFormat,
    "brain-npz-v1",
  );

  const invalid = request();
  invalid.end("not numeric weights");
  await assert.rejects(weights.upload(invalid as unknown as Request, "alice"));
  assert.equal(stored.length, 1);
  assert.equal(weights.receiving.size, 0);
  assert.equal(weights.validating, false);
});

test("an unfinished owner upload cannot block another owner's valid checkpoint", async () => {
  const { weights, stored } = fixture();
  const slow = request();
  const pending = weights
    .upload(slow as unknown as Request, "alice")
    .catch((error) => error);

  try {
    await receiving(slow);
    assert.equal(weights.validating, false);

    await assert.rejects(
      weights.upload(request() as unknown as Request, "alice"),
      status(429),
    );

    const complete = request();
    complete.end(await readFile("models/default/weights.npz"));
    const profile = await weights.upload(complete as unknown as Request, "bob");
    assert.ok(profile.sha256);
    assert.equal(stored.length, 1);
    assert.ok(weights.receiving.has("alice"));
  } finally {
    slow.destroy(Error("Fixture finished"));
    await pending;
  }

  assert.equal(weights.receiving.size, 0);
  assert.equal(weights.validating, false);
});

test("ingress is bounded across owners, and abort releases each reservation", async () => {
  const { weights } = fixture();
  const streams = Array.from({ length: 4 }, request);
  const pending = streams.map((stream, i) =>
    weights
      .upload(stream as unknown as Request, `owner-${i}`)
      .catch((error) => error),
  );

  try {
    await Promise.all(streams.map(receiving));

    await assert.rejects(
      weights.upload(request() as unknown as Request, "fifth"),
      status(429),
    );

    assert.equal(weights.validating, false);
  } finally {
    for (const stream of streams) {
      stream.destroy(Error("Fixture finished"));
    }

    await Promise.all(pending);
  }

  assert.equal(weights.receiving.size, 0);
});

test("a receiving request cannot release another request's validator reservation", async () => {
  const { weights } = fixture();
  weights.validating = true;
  const stream = request();
  stream.end("not an archive");

  await assert.rejects(
    weights.upload(stream as unknown as Request, "alice"),
    status(429),
  );

  assert.equal(weights.validating, true);
  assert.equal(weights.receiving.size, 0);
});

test("upload reception has an absolute deadline even when bytes arrive", async (t) => {
  const { weights } = fixture();
  const stream = request();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = weights.upload(stream as unknown as Request, "alice");
  const rejected = assert.rejects(pending, status(408));
  await receiving(stream);
  stream.write("a");
  t.mock.timers.tick(59000);
  stream.write("b");
  t.mock.timers.tick(1000);
  await rejected;
  assert.ok(stream.destroyed);
  assert.equal(weights.receiving.size, 0);
  assert.equal(weights.validating, false);
});
