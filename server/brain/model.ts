import type { NeuralActivity } from "../../shared/contracts.ts";
import { sampleNeurons } from "../../shared/neural.ts";
import { encodeBrainCheckpoint } from "./checkpoint.ts";
import type { BrainGraph } from "./graph.ts";
import { sha256 } from "./graph.ts";
import type { ArithmeticAction, ArithmeticPolicy } from "./policy.ts";
import { decodePolicy, validateExpression } from "./policy.ts";

interface BrainLayer {
  sources: number[];
  targets: number[];
  weights: number[];
  bias: number[];
}

export interface BrainCheckpoint {
  format: "fly-brain-v1";
  nodes: number[][];
  layers: BrainLayer[];
  encoder: number[][];
  encoderBias: number[];
  decoder: number[][];
  decoderBias: number[];
  graphHashes: Record<string, string>;
}

function vector(values: number[], length: number) {
  return (
    Array.isArray(values) &&
    values.length === length &&
    values.every(Number.isFinite)
  );
}

export class Brain implements ArithmeticPolicy {
  readonly limits = { maxKeys: 18 };
  private readonly definition: BrainCheckpoint;
  private readonly population: number;
  private states: number[][] = [];
  private answer = "";
  private position = 0;

  constructor(graph: BrainGraph, checkpoint: BrainCheckpoint) {
    if (
      checkpoint?.format !== "fly-brain-v1" ||
      !Array.isArray(checkpoint.nodes) ||
      checkpoint.nodes.length !== 4 ||
      !Array.isArray(checkpoint.layers) ||
      checkpoint.layers.length !== 3
    ) {
      throw Error("Invalid brain checkpoint");
    }
    const nodes = checkpoint.nodes.flat();
    if (
      checkpoint.nodes.some(
        (layer) =>
          !Array.isArray(layer) || layer.length < 1 || layer.length > 4096,
      ) ||
      new Set(nodes).size !== nodes.length ||
      nodes.some(
        (id) =>
          !Number.isSafeInteger(id) || id < 0 || id >= graph.offsets.length - 1,
      )
    ) {
      throw Error("Brain requires disjoint valid neuron layers");
    }
    for (const name of ["offsets", "edges", "post", "weights"] as const) {
      const array = graph[name];
      if (
        checkpoint.graphHashes?.[name] !==
        sha256(new Uint8Array(array.buffer, array.byteOffset, array.byteLength))
      ) {
        throw Error("Brain connectome hash mismatch");
      }
    }
    for (const [matrix, rows, columns] of [
      [checkpoint.encoder, checkpoint.nodes[0].length, 6],
      [checkpoint.decoder, 4, checkpoint.nodes[3].length],
    ] as const) {
      if (
        !Array.isArray(matrix) ||
        matrix.length !== rows ||
        matrix.some((row) => !vector(row, columns))
      ) {
        throw Error("Invalid brain encoder or decoder");
      }
    }
    if (
      !vector(checkpoint.encoderBias, checkpoint.nodes[0].length) ||
      !vector(checkpoint.decoderBias, 4)
    ) {
      throw Error("Invalid brain bias");
    }
    for (const [index, layer] of checkpoint.layers.entries()) {
      const before = checkpoint.nodes[index];
      const after = checkpoint.nodes[index + 1];
      if (
        !Array.isArray(layer.weights) ||
        !layer.weights.length ||
        layer.weights.length > before.length * after.length ||
        !vector(layer.weights, layer.weights.length) ||
        !vector(layer.sources, layer.weights.length) ||
        !vector(layer.targets, layer.weights.length) ||
        !vector(layer.bias, after.length)
      ) {
        throw Error("Invalid brain synapses");
      }
      const actual = new Map<number, Map<number, number>>();
      for (const source of before) {
        const targets = new Map<number, number>();
        for (
          let j = graph.offsets[source];
          j < graph.offsets[source + 1];
          j++
        ) {
          const edge = graph.edges[j];
          const target = graph.post[edge];
          targets.set(target, (targets.get(target) ?? 0) + graph.weights[edge]);
        }
        actual.set(source, targets);
      }
      const seen = new Set<string>();
      for (let i = 0; i < layer.weights.length; i++) {
        const source = layer.sources[i];
        const target = layer.targets[i];
        const key = `${source}:${target}`;
        if (
          !Number.isInteger(source) ||
          !Number.isInteger(target) ||
          source < 0 ||
          source >= before.length ||
          target < 0 ||
          target >= after.length ||
          seen.has(key)
        ) {
          throw Error("Invalid or repeated brain connection");
        }
        const original = actual.get(before[source])?.get(after[target]) ?? 0;
        if (!original || Math.sign(original) !== Math.sign(layer.weights[i])) {
          throw Error(
            "Brain connection is absent from the fly graph or changes its sign",
          );
        }
        seen.add(key);
      }
    }
    this.definition = structuredClone(checkpoint);
    this.population = graph.offsets.length - 1;
  }

  resetRun() {
    this.answer = "";
    this.position = 0;
    this.states = [];
  }

  estimate(expression: string) {
    const { left, right, operation } = validateExpression(expression);
    const a = Number(left);
    const b = Number(right);
    if (
      !Number.isSafeInteger(a) ||
      !Number.isSafeInteger(b) ||
      a < 0 ||
      b <= 0
    ) {
      throw Error(
        "Brain expects non-negative integer left operands and positive integer right operands",
      );
    }
    const op = "+-*/".indexOf(operation);
    const input = [
      Math.fround(a / [100, 200, 100, 10000][op]),
      Math.fround(b / 100),
      ...[0, 1, 2, 3].map((i) => Number(i === op)),
    ];
    const checkpoint = this.definition;
    let state = checkpoint.encoder.map((row, i) =>
      Math.tanh(
        row.reduce(
          (sum, weight, j) => sum + weight * input[j],
          checkpoint.encoderBias[i],
        ),
      ),
    );
    this.states = [state];
    for (const layer of checkpoint.layers) {
      const next = [...layer.bias];
      for (let i = 0; i < layer.weights.length; i++) {
        next[layer.targets[i]] += state[layer.sources[i]] * layer.weights[i];
      }
      state = next.map(Math.tanh);
      this.states.push(state);
    }
    const value =
      checkpoint.decoder[op].reduce(
        (sum, weight, i) => sum + weight * state[i],
        checkpoint.decoderBias[op],
      ) * [200, 100, 10000, 100][op];
    if (!Number.isFinite(value) || !Number.isSafeInteger(Math.round(value))) {
      throw Error("Brain estimate exceeds safe integer precision");
    }
    return value;
  }

  checkpoint() {
    return encodeBrainCheckpoint(this.definition);
  }

  predict(expression: string) {
    return decodePolicy(this, expression);
  }

  outputActivity() {
    return [...(this.states[3] ?? [])];
  }

  activeNeurons() {
    return this.states.reduce(
      (total, layer) => total + layer.filter((value) => value !== 0).length,
      0,
    );
  }

  activity(): NeuralActivity {
    const inputs = this.definition.nodes[0];
    const rates: [number, number, number][] = [];
    for (const [index, state] of this.states.entries()) {
      const ids = this.definition.nodes[index];
      const values = new Map(ids.map((id, i) => [id, state[i]]));
      const selected = sampleNeurons(ids, (id) => values.get(id)!, inputs, 48);
      rates.push(
        ...selected.map((id): [number, number, number] => [
          id,
          index + 1,
          values.get(id)!,
        ]),
      );
    }
    return {
      spikes: [],
      totalSpikes: 0,
      durationMs: 0,
      population: this.population,
      activeNeurons: this.activeNeurons(),
      inputs: [...inputs],
      rateSteps: this.states.length,
      rates,
    };
  }

  beginProblem(expression: string, rejected: readonly string[] = []) {
    this.resetRun();
    const estimate = this.estimate(expression);
    // Quantise the same neural estimate; retries never evaluate the expression.
    const centre = Math.round(estimate);
    const candidates = [centre - 1, centre, centre + 1]
      .filter(Number.isSafeInteger)
      .sort((a, b) => Math.abs(a - estimate) - Math.abs(b - estimate));
    const next = candidates.find(
      (answer) => !rejected.includes(String(answer)),
    );
    if (next === undefined) {
      throw Error("Brain exhausted its three nearest integer predictions");
    }
    this.answer = String(next);
  }

  nextAction(): ArithmeticAction {
    return (
      (this.answer[this.position++] as ArithmeticAction | undefined) ?? "end"
    );
  }
}
