import type { Archive, ExportArray, NumericDecodedArray } from "./arrays.ts";
import { encodeArchive } from "./arrays.ts";
import type { BrainCheckpoint } from "./model.ts";

export const CHECKPOINT_VERSION = 11;
const HASHES = ["offsets", "edges", "post", "weights"] as const;

export function decodeCheckpoint(archive: Archive): BrainCheckpoint {
  const used = new Set<string>();
  function array(name: string, dtype: string, shape?: number[]) {
    used.add(name);
    const row = archive[name];
    if (
      !row ||
      row.dtype === "U" ||
      `${row.dtype}${row.width}` !== dtype ||
      row.data.some((value) => !Number.isFinite(value)) ||
      (shape &&
        (row.shape.length !== shape.length ||
          row.shape.some((size, i) => size !== shape[i])))
    ) {
      throw Error(`Invalid brain array: ${name}`);
    }
    return row as NumericDecodedArray;
  }
  if (array("format_version", "f8", []).data[0] !== CHECKPOINT_VERSION) {
    throw Error("Unsupported brain weights version");
  }
  const nodes = Array.from({ length: 4 }, (_, i) => {
    const row = array(`nodes_${i}`, "u4");
    if (
      row.shape.length !== 1 ||
      row.data.length < 1 ||
      row.data.length > 4096
    ) {
      throw Error("Invalid brain neuron dimensions");
    }
    return Array.from(row.data);
  });
  const layers = Array.from({ length: 3 }, (_, i) => {
    const weights = array(`weights_${i}`, "f8");
    const count = weights.data.length;
    if (
      weights.shape.length !== 1 ||
      !count ||
      count > Math.min(1000000, nodes[i].length * nodes[i + 1].length)
    ) {
      throw Error("Invalid brain synapse dimensions");
    }
    return {
      sources: Array.from(array(`sources_${i}`, "u4", [count]).data),
      targets: Array.from(array(`targets_${i}`, "u4", [count]).data),
      weights: Array.from(weights.data),
      bias: Array.from(array(`bias_${i}`, "f8", [nodes[i + 1].length]).data),
    };
  });
  function matrix(name: string, rows: number, columns: number) {
    const values = array(name, "f8", [rows, columns]).data;
    return Array.from({ length: rows }, (_, i) =>
      Array.from(values.subarray(i * columns, (i + 1) * columns)),
    );
  }
  const checkpoint: BrainCheckpoint = {
    format: "fly-brain-v1",
    nodes,
    layers,
    encoder: matrix("encoder", nodes[0].length, 6),
    encoderBias: Array.from(
      array("encoder_bias", "f8", [nodes[0].length]).data,
    ),
    decoder: matrix("decoder", 4, nodes[3].length),
    decoderBias: Array.from(array("decoder_bias", "f8", [4]).data),
    graphHashes: Object.fromEntries(
      HASHES.map((name) => [
        name,
        Buffer.from(array(`graph_${name}_sha256`, "u1", [32]).data).toString(
          "hex",
        ),
      ]),
    ),
  };
  if (Object.keys(archive).some((name) => !used.has(name))) {
    throw Error("Unexpected brain checkpoint array");
  }
  return checkpoint;
}

export function encodeBrainCheckpoint(checkpoint: BrainCheckpoint) {
  const arrays: Record<string, ExportArray> = {
    format_version: { data: CHECKPOINT_VERSION },
  };
  function vector(name: string, values: ArrayLike<number>, dtype = "<f8") {
    arrays[name] = { data: values, shape: [values.length], dtype };
  }
  checkpoint.nodes.forEach((nodes, i) => {
    vector(`nodes_${i}`, nodes, "<u4");
  });
  checkpoint.layers.forEach((layer, i) => {
    vector(`sources_${i}`, layer.sources, "<u4");
    vector(`targets_${i}`, layer.targets, "<u4");
    vector(`weights_${i}`, layer.weights);
    vector(`bias_${i}`, layer.bias);
  });
  for (const name of ["encoder", "decoder"] as const) {
    const matrix = checkpoint[name];
    arrays[name] = {
      data: matrix.flat(),
      shape: [matrix.length, matrix[0].length],
      dtype: "<f8",
    };
    vector(`${name}_bias`, checkpoint[`${name}Bias`]);
  }
  for (const name of HASHES) {
    vector(
      `graph_${name}_sha256`,
      Buffer.from(checkpoint.graphHashes[name], "hex"),
      "<u1",
    );
  }
  return encodeArchive(arrays);
}
