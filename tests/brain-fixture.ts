import type { BrainGraph } from "../server/brain/graph.ts";
import { sha256 } from "../server/brain/graph.ts";
import type { BrainCheckpoint } from "../server/brain/model.ts";

export function brainFixture(graph: BrainGraph): BrainCheckpoint {
  const nodes = [[graph.inputs[0]]];
  const layers: BrainCheckpoint["layers"] = [];
  for (let i = 0; i < 3; i++) {
    const source = nodes[i][0];
    let selected: number | undefined;
    for (let j = graph.offsets[source]; j < graph.offsets[source + 1]; j++) {
      const edge = graph.edges[j];
      if (graph.weights[edge] && !nodes.flat().includes(graph.post[edge])) {
        selected = edge;
        break;
      }
    }
    if (selected === undefined) {
      throw Error("Fixture requires a four-neuron path");
    }
    nodes.push([graph.post[selected]]);
    layers.push({
      sources: [0],
      targets: [0],
      weights: [Math.sign(graph.weights[selected])],
      bias: [0.25],
    });
  }
  return {
    format: "fly-brain-v1",
    nodes,
    layers,
    encoder: [[0, 0, 0, 0, 0, 0]],
    encoderBias: [0.5],
    decoder: [[0], [0], [0], [0]],
    decoderBias: [9 / 200, 9 / 100, 9 / 10000, 9 / 100],
    graphHashes: Object.fromEntries(
      (["offsets", "edges", "post", "weights"] as const).map((name) => {
        const array = graph[name];
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
