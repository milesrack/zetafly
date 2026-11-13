import { loadAnatomy } from "../../server/brain/anatomy.ts";
import type { BrainGraph } from "../../server/brain/graph.ts";
import { loadGraph, sha256 } from "../../server/brain/graph.ts";
import type { BrainCheckpoint } from "../../server/brain/model.ts";

export async function prepareCircuit() {
  const graph = await loadGraph();
  const { sensory, readout } = await loadAnatomy();
  const count = graph.offsets.length - 1;
  const sensorySet = new Set(sensory);
  const motorSet = new Set(readout);
  const available = Array.from({ length: count }, (_, i) => i).filter(
    (i) => !sensorySet.has(i) && !motorSet.has(i),
  );
  const incoming = new Float64Array(count);
  const outgoing = new Float64Array(count);
  const future = new Float64Array(count);

  function edges(
    visit: (source: number, target: number, weight: number) => void,
    sources = available,
  ) {
    for (const source of sources) {
      for (let i = graph.offsets[source]; i < graph.offsets[source + 1]; i++) {
        const edge = graph.edges[i];
        visit(source, graph.post[edge], graph.weights[edge]);
      }
    }
  }

  function strongest(
    nodes: number[],
    limit: number,
    score: (node: number) => number,
    positive = false,
  ) {
    return nodes
      .map((node) => ({ node, score: score(node) }))
      .filter((entry) => !positive || entry.score > 0)
      .sort((a, b) => a.score - b.score || a.node - b.node)
      .slice(-limit)
      .map((entry) => entry.node);
  }

  edges((_, target, weight) => {
    incoming[target] += Math.abs(weight);
  }, sensory);
  edges((source, target, weight) => {
    if (motorSet.has(target)) {
      outgoing[source] += Math.abs(weight);
    }
  });
  const candidates = new Set(available.filter((node) => outgoing[node] > 0));
  edges((source, target, weight) => {
    if (candidates.has(target)) {
      future[source] += Math.abs(weight) * Math.log1p(outgoing[target]);
    }
  });

  const first = strongest(
    available,
    512,
    (node) => Math.log1p(incoming[node]) * Math.log1p(future[node]),
    true,
  );
  const firstSet = new Set(first);
  incoming.fill(0);
  edges((_, target, weight) => {
    incoming[target] += Math.abs(weight);
  }, first);
  const second = strongest(
    available.filter((node) => !firstSet.has(node)),
    512,
    (node) => Math.log1p(incoming[node]) * Math.log1p(outgoing[node]),
    true,
  );
  const strength = new Float64Array(count);
  edges((source, target, weight) => {
    if (firstSet.has(target)) {
      strength[source] += Math.abs(weight);
    }
  }, sensory);
  edges((_, target, weight) => {
    if (motorSet.has(target)) {
      strength[target] += Math.abs(weight);
    }
  }, second);
  const nodes = [
    strongest(sensory, 256, (node) => strength[node]),
    first,
    second,
    strongest(readout, 128, (node) => strength[node]),
  ];

  const graphHashes = Object.fromEntries(
    (["offsets", "edges", "post", "weights"] as const).map((name) => {
      const { buffer, byteOffset, byteLength } = graph[name];
      return [name, sha256(new Uint8Array(buffer, byteOffset, byteLength))];
    }),
  );
  return { graph, nodes, layers: initialLayers(graph, nodes), graphHashes };
}

export function initialLayers(graph: BrainGraph, nodes: number[][]) {
  return nodes.slice(1).map((targets, index) => {
    const sources = nodes[index];
    const sourceIndex = new Map(sources.map((node, i) => [node, i]));
    const targetIndex = new Map(targets.map((node, i) => [node, i]));
    const matrix = targets.map(() => new Float32Array(sources.length));

    for (const source of sources) {
      for (let i = graph.offsets[source]; i < graph.offsets[source + 1]; i++) {
        const edge = graph.edges[i];
        const row = targetIndex.get(graph.post[edge]);
        if (row !== undefined) {
          matrix[row][sourceIndex.get(source)!] += graph.weights[edge];
        }
      }
    }

    const layer: BrainCheckpoint["layers"][number] = {
      sources: [],
      targets: [],
      weights: [],
      bias: targets.map(() => 0),
    };
    for (const [target, row] of matrix.entries()) {
      const norm = Math.max(
        1,
        Math.sqrt(row.reduce((sum, weight) => sum + weight * weight, 0)),
      );
      for (const [source, weight] of row.entries()) {
        if (weight !== 0) {
          layer.sources.push(source);
          layer.targets.push(target);
          layer.weights.push(
            Math.sign(weight) * Math.max(1e-6, Math.abs(weight) / norm),
          );
        }
      }
    }
    return layer;
  });
}
