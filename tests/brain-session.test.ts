import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadGraph } from "../server/brain/graph.ts";
import { Brain } from "../server/brain/model.ts";
import { inspectWeights } from "../server/brain/weights.ts";
import { NeuralWorker } from "../server/neural-worker.ts";
import { brainFixture } from "./brain-fixture.ts";

test("brain uploads preserve neural predictions, retries, and actual activity through the worker", async () => {
  const graph = await loadGraph();
  const definition = brainFixture(graph);
  const brain = new Brain(graph, definition);
  const bytes = brain.checkpoint();
  const metadata = await inspectWeights(bytes);
  const directory = await mkdtemp(join(tmpdir(), "zetafly-brain-test-"));
  const path = join(directory, "weights.npz");
  await writeFile(path, bytes);
  const worker = new NeuralWorker(path, metadata.sha256);
  try {
    const result = await worker.predict(2, 3, 7, "+");
    assert.equal(result.answerText, "9");
    assert.ok(result.neural);
    assert.equal(result.neural.rateSteps, 4);
    assert.equal(result.neural.totalSpikes, 0);
    assert.deepEqual(
      result.neural.rates?.map(([id]) => id),
      definition.nodes.flat(),
    );
    assert.equal(result.neural.rates?.length, 4);
    const retry = await worker.predict(2, 3, 8, "+", undefined, ["9"]);
    assert.equal(retry.answerText, "8");
    const repeated = await worker.predict(2, 3, 9, "+");
    assert.deepEqual(repeated.neural, result.neural);
    assert.equal(repeated.answerText, "9");
  } finally {
    await worker.close();
    await rm(directory, { recursive: true, force: true });
  }
});
