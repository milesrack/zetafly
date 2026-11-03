import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { zipSync } from "fflate";
import {
  decodeArchive,
  encodeArchive,
  encodeArray,
} from "../server/brain/arrays.ts";
import { SequenceTrainer } from "../server/brain/sequence-training.ts";
import { restoreWeights, weightsMetadata } from "../server/brain/weights.ts";

import { DEFAULT_SETTINGS } from "../shared/settings.ts";

const graph = {
  inputs: [0],
  offsets: new Uint32Array([0, 1, 2]),
  edges: new Uint32Array([0, 1]),
  post: new Uint32Array([1, 0]),
  weights: new Float64Array([1, -1]),
};
const model = new SequenceTrainer(graph, {
  seed: 42,
  sensory: [0],
  readout: [1],
  steps: 1,
  settle: 0,
  maxKeys: 8,
  encoding: "place",
  anatomySha256: "a".repeat(64),
});

function arrays() {
  return Object.fromEntries(
    Object.entries(decodeArchive(model.checkpoint())).map(([key, row]) => {
      assert.notEqual(row.dtype, "U");

      return [
        key,
        {
          data: row.data,
          shape: row.shape,
          dtype: `<${row.dtype}${"width" in row ? row.width : 1}`,
        },
      ];
    }),
  );
}

test("supported NPZ weights preserve predictions with and without optimiser arrays", () => {
  const full = model.checkpoint();
  assert.equal(weightsMetadata(full).features, model.options.readout.length);
  assert.equal(weightsMetadata(full).arithmeticMode, "sequence");

  assert.deepEqual(
    restoreWeights(graph, full).predict("17*6"),
    model.predict("17*6"),
  );

  const deployed = arrays();
  delete deployed.first;
  delete deployed.second;

  assert.deepEqual(
    restoreWeights(graph, encodeArchive(deployed)).predict("17*6"),
    model.predict("17*6"),
  );
});

test("weights reject unexpected arrays, altered shapes/dtypes, nonfinite values, and a different connectome", () => {
  for (const mutate of [
    (rows: ReturnType<typeof arrays>) => {
      rows.extra = { data: new Float64Array([1]), shape: [1], dtype: "<f8" };
    },
    (rows: ReturnType<typeof arrays>) => {
      rows.parameters.shape = [1, model.parameters.length];
    },
    (rows: ReturnType<typeof arrays>) => {
      rows.parameters.dtype = "<f4";
    },
    (rows: ReturnType<typeof arrays>) => {
      rows.parameters.data = Float64Array.from(model.parameters, () => NaN);
    },
    (rows: ReturnType<typeof arrays>) => {
      rows.format_version.data = new Float64Array([7]);
    },
    (rows: ReturnType<typeof arrays>) => {
      rows.second.data = Float64Array.from(model.parameters, () => -1);
    },
  ]) {
    const rows = arrays();
    mutate(rows);
    assert.throws(() => restoreWeights(graph, encodeArchive(rows)));
  }

  assert.throws(
    () =>
      restoreWeights(
        { ...graph, weights: new Float64Array([2, -1]) },
        model.checkpoint(),
      ),
    /graph/i,
  );
});

test("weights reject code archives and NPY object arrays without executing them", () => {
  assert.throws(() =>
    restoreWeights(
      graph,
      zipSync({
        "model.mjs": new TextEncoder().encode("throw Error('executed')"),
      }),
    ),
  );

  const object = encodeArray([1], [1], "<f8");
  const header = new TextDecoder().decode(object).indexOf("<f8");
  object.set(new TextEncoder().encode("|O8"), header);

  assert.throws(
    () => restoreWeights(graph, zipSync({ "parameters.npy": object })),
    /numeric/i,
  );
});

test("numeric nonlinear readouts pass upload inspection and reject invalid widths", () => {
  const nonlinear = new SequenceTrainer(graph, { ...model.options, hidden: 8 });
  const bytes = nonlinear.checkpoint();
  assert.equal(weightsMetadata(bytes).features, 1);
  assert.deepEqual(
    restoreWeights(graph, bytes).predict("2+3"),
    nonlinear.predict("2+3"),
  );

  for (const width of [0, 257, 1.5]) {
    const archive = decodeArchive(bytes);
    assert.notEqual(archive.config.dtype, "U");
    const config = Array.from(archive.config.data as ArrayLike<number>);
    config[5] = width;
    const invalid = encodeArchive(
      Object.fromEntries(
        Object.entries(archive).map(([name, row]) => [
          name,
          {
            data: name === "config" ? config : row.data,
            shape: row.shape,
            dtype: row.dtype === "U" ? undefined : `<${row.dtype}${row.width}`,
          },
        ]),
      ),
    );
    assert.throws(() => weightsMetadata(invalid), /readout width/);
  }
});

test("inference exports omit optimiser state and malformed dimensions fail before model construction", () => {
  const nonlinear = new SequenceTrainer(graph, { ...model.options, hidden: 8 });
  const inference = restoreWeights(graph, nonlinear.checkpoint());
  const deployedBytes = inference.checkpoint();
  const deployed = decodeArchive(deployedBytes);
  assert.equal(deployed.first, undefined);
  assert.equal(deployed.second, undefined);
  assert.deepEqual(
    restoreWeights(graph, inference.checkpoint()).predict("2+3"),
    nonlinear.predict("2+3"),
  );
  assert.equal("learnFeatures" in inference, false);
  const inferenceOnlyTrainer = SequenceTrainer.restore(graph, deployedBytes, {
    inference: true,
  });

  assert.throws(
    () => inferenceOnlyTrainer.learnFeatures(inference.features("2+3", "9")),
    /Warm-start/,
  );
  const archive = decodeArchive(nonlinear.checkpoint());
  const malformed = encodeArchive(
    Object.fromEntries(
      Object.entries(archive).map(([name, row]) => [
        name,
        {
          data: name === "parameters" ? [1] : row.data,
          shape: name === "parameters" ? [1] : row.shape,
          dtype: row.dtype === "U" ? undefined : `<${row.dtype}${row.width}`,
        },
      ]),
    ),
  );
  assert.throws(() => restoreWeights(graph, malformed), /parameter dimensions/);
});

test("the published checkpoint matches its recorded predictions", async () => {
  const bytes = await readFile("models/default/weights.npz");
  const report = JSON.parse(
    await readFile("models/default/evaluation.json", "utf8"),
  );
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    report.checkpointSha256,
  );
  assert.deepEqual(report.settings, DEFAULT_SETTINGS);
  assert.equal(report.audit.cases.length, report.audit.examples);
  assert.equal(
    report.audit.cases.filter(
      (row: { terminated: boolean; answer: string; expected: string }) =>
        row.terminated && row.answer === row.expected,
    ).length,
    report.audit.correct,
  );
});
