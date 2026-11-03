import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadGraph } from "../server/brain/graph.ts";
import { SequenceTrainer } from "../server/brain/sequence-training.ts";
import { inspectWeights } from "../server/brain/weights.ts";
import { NeuralWorker } from "../server/neural-worker.ts";

test("sequence NPZ weights preserve predictions through upload inspection and worker inference", async () => {
  const graph = await loadGraph();
  const model = new SequenceTrainer(graph, {
    seed: 7,
    steps: 1,
    settle: 0,
    maxKeys: 5,
    sensory: graph.inputs.slice(0, 4),
    readout: graph.inputs.slice(0, 4),
    anatomySha256: "a".repeat(64),
    encoding: "place",
  });
  const rows = model.features("2+3", "009");
  model.calibrate(rows);

  for (let i = 0; i < 2000; i++) {
    model.learnFeatures(rows, 0.03);
  }

  assert.equal(model.predict("2+3").answer, "009");
  const bytes = model.checkpoint();
  const metadata = await inspectWeights(bytes);
  assert.equal(metadata.arithmeticMode, "sequence");
  const directory = await mkdtemp(join(tmpdir(), "zetafly-sequence-test-"));
  const path = join(directory, "weights.npz");
  await writeFile(path, bytes);
  const worker = new NeuralWorker(path, metadata.sha256);

  try {
    let observations = 0;
    const result = await worker.predict(2, 3, 7, "+", (packet) => {
      observations++;
      assert.ok(packet.neural.rates?.length);
    });

    assert.equal(result.answer, 9);
    assert.equal(result.answerText, "9");
    assert.equal(observations, 4);
    const repeated = await worker.predict(2, 3, 7, "+");
    assert.equal(repeated.answerText, result.answerText);
    assert.deepEqual(repeated.neural, result.neural);
    const retry = await worker.predict(2, 3, 8, "+", undefined, ["9"]);
    assert.notEqual(retry.answer, 9);
    const nextProblem = await worker.predict(2, 3, 9, "+");
    assert.equal(nextProblem.answerText, "9");
  } finally {
    await worker.close();
    await rm(directory, { recursive: true, force: true });
  }
});
