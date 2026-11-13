import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluate,
  examples,
  inference,
  randomGenerator,
  splitExamples,
  trainer,
} from "../research/connectome-arithmetic/model.ts";
import { fitReadout } from "../research/connectome-arithmetic/readout.ts";
import type { BrainCheckpoint } from "../server/brain/model.ts";

test("commuted operands and inverse operations stay within one split", () => {
  const banks = splitExamples();
  assert.equal(banks.flat().length, 99 ** 2 * 4);
  const expressions = banks.map(
    (bank) => new Set(bank.map((row) => row.expression)),
  );
  for (const a of [2, 17, 100]) {
    for (const b of [2, 23, 100]) {
      const rows = [...examples(a, b), ...examples(b, a)];
      assert.equal(
        expressions.filter((bank) =>
          rows.every((row) => bank.has(row.expression)),
        ).length,
        1,
      );
    }
  }
});

test("readout solves a rank-deficient design and applies the singular value cutoff", () => {
  const fits = fitReadout(
    [
      [1, 1, 0],
      [0, 0, 1e-6],
      [2, 2, 0],
    ],
    [4, 3e-6, 8],
  );
  assert.ok(Math.abs(fits[0][0] - 2) < 1e-12);
  assert.ok(Math.abs(fits[0][1] - 2) < 1e-12);
  assert.equal(fits[0][2], 0);
  assert.ok(Math.abs(fits.at(-1)![2] - 3) < 1e-12);
});

test("Adam reduces training loss while preserving synapse signs", () => {
  const model: BrainCheckpoint = {
    format: "fly-brain-v1",
    nodes: [[0], [1], [2], [3]],
    layers: [0.5, -0.5, 0.5].map((weight) => ({
      sources: [0],
      targets: [0],
      weights: [weight],
      bias: [0],
    })),
    encoder: [[0.3, -0.2, 0.1, 0, 0, 0]],
    encoderBias: [0],
    decoder: [[0.1], [0.1], [0.1], [0.1]],
    decoderBias: [0, 0, 0, 0],
    graphHashes: {},
  };
  const rows = examples(17, 23);
  const { estimate } = inference(model);
  const update = trainer(model, randomGenerator(42));
  const before = evaluate(rows, estimate).loss;
  for (let step = 1; step <= 200; step++) {
    update(rows, step, 16);
  }
  assert.ok(evaluate(rows, estimate).loss < before / 10);
  assert.deepEqual(
    model.layers.map((layer) => Math.sign(layer.weights[0])),
    [1, -1, 1],
  );
});
