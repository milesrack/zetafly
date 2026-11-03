import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { cacheSequenceFeatures } from "../scripts/feature-cache.ts";
import { trainReadout } from "../scripts/readout-training.ts";
import { loadGraph } from "../server/brain/graph.ts";
import { SequenceTrainer } from "../server/brain/sequence-training.ts";

test("feature caching preserves exact values across workers, restart, and recalibration", async () => {
  const model = SequenceTrainer.restore(
    await loadGraph(),
    await readFile("models/default/weights.npz"),
    { inference: true },
  );
  const rows = [
    { expression: "2+3", answer: "5" },
    { expression: "12*99", answer: "1188" },
  ];
  const before = model.parameters.slice();
  const expected = rows.map((row) =>
    model.features(row.expression, row.answer),
  );
  const directory = await mkdtemp(join(tmpdir(), "zetafly-features-"));
  const path = join(directory, "features.cache");
  const progress: number[] = [];
  const actual = await cacheSequenceFeatures(
    model,
    rows,
    2,
    (completed) => {
      progress.push(completed);
    },
    path,
  );
  await appendFile(path, Uint8Array.of(0, 1));
  const resumed = await cacheSequenceFeatures(model, rows, 1, undefined, path);
  assert.deepEqual(resumed, expected);
  model.parameters[model.embeddingStart] += 0.01;
  await assert.rejects(cacheSequenceFeatures(model, rows, 1, undefined, path));
  model.parameters.set(before);
  await rm(directory, { recursive: true });
  assert.deepEqual(actual, expected);
  assert.deepEqual(model.parameters, before);
  const flat = expected.flat();
  const beforeLoss = flat.map((row) => model.featureLoss(row));
  trainReadout(
    model,
    expected,
    expected,
    { updates: 0, batch: 1, rate: 0.001, validateEvery: 1, patience: null },
    () => 0,
    { preserveReadout: true },
  );
  flat.forEach((row, i) => {
    assert.ok(Math.abs(model.featureLoss(row) - beforeLoss[i]) < 1e-8);
  });
  assert.equal(progress.at(-1), rows.length);
  await assert.rejects(cacheSequenceFeatures(model, rows, 0));
});
