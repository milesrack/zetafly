import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeArchive,
  encodeArchive,
  type NumericDecodedArray,
} from "../server/brain/arrays.ts";
import type { BrainGraph } from "../server/brain/graph.ts";
import { sha256 } from "../server/brain/graph.ts";
import type { BrainCheckpoint } from "../server/brain/model.ts";
import { Brain } from "../server/brain/model.ts";
import { decodePolicy } from "../server/brain/policy.ts";
import { restoreWeights, weightsMetadata } from "../server/brain/weights.ts";

const graph: BrainGraph = {
  inputs: [0],
  offsets: new Uint32Array([0, 1, 2, 3, 3]),
  edges: new Uint32Array([0, 1, 2]),
  post: new Uint32Array([1, 2, 3]),
  weights: new Float64Array([1, -1, 1]),
};
function fixture(): BrainCheckpoint {
  return {
    format: "fly-brain-v1",
    nodes: [[0], [1], [2], [3]],
    layers: [1, -1, 1].map((weight) => ({
      sources: [0],
      targets: [0],
      weights: [weight],
      bias: [0],
    })),
    encoder: [[1, 0, 0, 0, 0, 0]],
    encoderBias: [0],
    decoder: [[1], [1], [1], [1]],
    decoderBias: [0, 0, 0, 0],
    graphHashes: Object.fromEntries(
      ["offsets", "edges", "post", "weights"].map((name) => {
        const array = graph[name as keyof typeof graph] as
          Uint32Array | Float64Array;
        return [
          name,
          sha256(
            new Uint8Array(array.buffer, array.byteOffset, array.byteLength),
          ),
        ];
      }),
    ),
  };
}

test("brain output depends on its actual signed internal synapses", () => {
  const checkpoint = fixture();
  const original = new Brain(graph, checkpoint).estimate("30+20");
  assert.ok(original < 0);
  checkpoint.layers[1].weights[0] = -0.1;
  const changed = new Brain(graph, checkpoint).estimate("30+20");
  assert.ok(Math.abs(changed) < Math.abs(original) / 2);
});

test("retries are limited to three integers around the neural estimate", () => {
  const checkpoint = fixture();
  checkpoint.decoder = [[0], [0], [0], [0]];
  const brain = new Brain(graph, checkpoint);
  assert.equal(decodePolicy(brain, "99+1").answer, "0");
  assert.equal(decodePolicy(brain, "99+1", undefined, ["0"]).answer, "-1");
  assert.equal(decodePolicy(brain, "99+1", undefined, ["0", "-1"]).answer, "1");
  assert.throws(
    () => decodePolicy(brain, "99+1", undefined, ["0", "-1", "1"]),
    /exhausted/,
  );
  assert.equal(brain.nextAction(), "end");
  assert.equal(decodePolicy(brain, "99+1").answer, "0");
});

test("checkpoint cannot substitute graph connections, signs, or overlapping neurons", () => {
  const wrongGraph = fixture();
  wrongGraph.graphHashes.post = "0".repeat(64);
  assert.throws(() => new Brain(graph, wrongGraph), /hash/);
  const wrongSign = fixture();
  wrongSign.layers[1].weights[0] = 1;
  assert.throws(() => new Brain(graph, wrongSign), /sign/);
  const overlapping = fixture();
  overlapping.nodes[2] = [1];
  assert.throws(() => new Brain(graph, overlapping), /disjoint/);
  const missingEdge = fixture();
  missingEdge.nodes = [[0], [2], [1], [3]];
  assert.throws(() => new Brain(graph, missingEdge), /absent/);
});

test("malformed coefficients and unsupported expressions fail before inference", () => {
  const invalid = fixture();
  invalid.decoder[0][0] = Number.NaN;
  assert.throws(() => new Brain(graph, invalid), /decoder/);
  const duplicate = fixture();
  duplicate.layers[0] = {
    sources: [0, 0],
    targets: [0, 0],
    weights: [1, 1],
    bias: [0],
  };
  assert.throws(() => new Brain(graph, duplicate), /synapses|repeated/);
  const brain = new Brain(graph, fixture());
  for (const expression of ["1/0", "-1*2", "1+2+3", "9007199254740992+1"]) {
    assert.throws(() => brain.estimate(expression), expression);
  }
});

test("brain NPZ upload format preserves float64 coefficients and predictions", () => {
  const definition = fixture();
  definition.decoderBias[0] = 12345678.123456789;
  const original = new Brain(graph, definition);
  const bytes = original.checkpoint();
  const restored = restoreWeights(graph, bytes);
  assert.ok(restored instanceof Brain);
  assert.equal(restored.estimate("30+20"), original.estimate("30+20"));
  assert.deepEqual(restored.predict("30+20"), original.predict("30+20"));
  assert.equal(weightsMetadata(bytes).features, 1);
});

test("brain NPZ rejects extra arrays, wrong precision, malformed dimensions, and changed signs", () => {
  const bytes = new Brain(graph, fixture()).checkpoint();
  for (const mutation of [
    "precision",
    "shape",
    "extra",
    "nonfinite",
    "sign",
    "version",
  ]) {
    const arrays = Object.fromEntries(
      Object.entries(decodeArchive(bytes)).map(([key, row]) => {
        assert.notEqual(row.dtype, "U");
        const numeric = row as NumericDecodedArray;
        return [
          key,
          {
            data: Array.from(numeric.data),
            shape: numeric.shape,
            dtype: `<${numeric.dtype}${numeric.width}`,
          },
        ];
      }),
    );
    if (mutation === "version") {
      arrays.format_version.data = [10];
    }
    if (mutation === "precision") {
      arrays.decoder.dtype = "<f4";
    }
    if (mutation === "shape") {
      arrays.encoder.shape = [6, 1];
    }
    if (mutation === "extra") {
      arrays.extra = { data: [1], shape: [], dtype: "<f8" };
    }
    if (mutation === "nonfinite") {
      arrays.decoder.data[0] = NaN;
    }
    if (mutation === "sign") {
      arrays.weights_1.data[0] = 1;
    }
    assert.throws(() => restoreWeights(graph, encodeArchive(arrays)), mutation);
  }
});
