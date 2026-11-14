import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import { chromium } from "playwright";
import { prepareDatabase } from "../server/database.ts";
import { NeuralWorker } from "../server/neural-worker.ts";
import type { Operation } from "../shared/contracts.ts";

// Also runs through stdin from /app/server, matching the other Docker fixtures.
process.chdir(fileURLToPath(new URL("..", import.meta.url)));

const browser = await chromium.launch({
  headless: true,
  chromiumSandbox: false,
});

try {
  const page = await browser.newPage();
  await page.setContent('<input aria-label="Answer">');
  await page.getByRole("textbox", { name: "Answer" }).pressSequentially("5");
  assert.equal(
    await page.getByRole("textbox", { name: "Answer" }).inputValue(),
    "5",
  );
  assert.ok((await page.screenshot()).length);
} finally {
  await browser.close();
}

const client = await new MongoClient(process.env.MONGODB_URI!).connect();
const db = client.db(`zetafly_migration_${randomUUID().replaceAll("-", "")}`);

try {
  await db.collection("sessions").insertOne({
    id: "legacy",
    ownerId: "alice",
    startedAt: new Date(0),
    events: [],
  });
  await db.collection("sessions").createIndex({ id: 1 }, { unique: true });
  const original = await db.collection("sessions").findOne({ id: "legacy" });
  await db.collection("session").insertOne({ id: "auth" });
  await prepareDatabase(db);
  assert.deepEqual(
    await db.collection("runs").findOne({ id: "legacy" }),
    original,
  );
  assert.equal(await db.listCollections({ name: "sessions" }).hasNext(), false);
  assert.equal(await db.collection("session").countDocuments({}), 1);
  await prepareDatabase(db);
  assert.equal(await db.collection("runs").countDocuments({}), 1);
  assert.ok(
    (await db.collection("runs").indexes()).some(
      (index) => index.unique && index.key.id === 1,
    ),
  );
  await db.collection("sessions").insertOne({ id: "collision" });
  await assert.rejects(prepareDatabase(db));
  assert.equal(await db.collection("runs").countDocuments({}), 1);
  assert.equal(await db.collection("sessions").countDocuments({}), 1);
} finally {
  await db.dropDatabase();
  await client.close();
}

const worker = new NeuralWorker();
const examples: [number, number, Operation, string][] = [
  [2, 3, "+", "5"],
  [5, 2, "-", "3"],
  [2, 3, "*", "6"],
  [6, 2, "/", "3"],
];

try {
  for (const [a, b, operation, answer] of examples) {
    let first: [number, number, number] | undefined;
    let prediction: Awaited<ReturnType<NeuralWorker["predict"]>> | undefined;
    const rejected: string[] = [];

    for (let attempt = 0; attempt < 3; attempt++) {
      prediction = await worker.predict(
        a,
        b,
        42,
        operation,
        (packet) => {
          first ??= packet.neural.rates?.[0];
        },
        rejected,
      );

      if (prediction.answerText === answer) {
        break;
      }

      rejected.push(prediction.answerText!);
    }

    assert.ok(prediction);
    assert.equal(prediction.answerText, answer);
    assert.ok(prediction.neural?.rates?.length);
    assert.ok(first);
    const firstSample = first;

    assert.ok(
      prediction.neural.rates.some(
        (sample) =>
          sample[0] === firstSample[0] && sample[1] === firstSample[1],
      ),
    );
  }

  await worker.close();
  assert.equal((await worker.predict(2, 3, 42, "+")).answerText, "5");
} finally {
  await worker.close();
}
