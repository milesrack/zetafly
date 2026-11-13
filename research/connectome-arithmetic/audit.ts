import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { decodeArchive } from "../../server/brain/arrays.ts";
import { decodeCheckpoint } from "../../server/brain/checkpoint.ts";
import { loadGraph } from "../../server/brain/graph.ts";
import type { BrainCheckpoint } from "../../server/brain/model.ts";
import { Brain } from "../../server/brain/model.ts";
import { initialLayers } from "./circuit.ts";
import type { Example } from "./model.ts";
import {
  evaluate,
  examples,
  inference,
  randomGenerator,
  splitExamples,
} from "./model.ts";

const { values } = parseArgs({
  options: { model: { type: "string" }, output: { type: "string" } },
});
const output = values.output;
if (!values.model || !output) {
  throw Error("Provide --model weights.json or weights.npz and --output");
}
await mkdir(join(output, ".."), { recursive: true });
await mkdir(output);
const bytes = await readFile(values.model);
const model: BrainCheckpoint = values.model.endsWith(".npz")
  ? decodeCheckpoint(decodeArchive(bytes))
  : JSON.parse(bytes.toString());
const graph = await loadGraph();
new Brain(graph, model);
const [, validation, test] = splitExamples();
const random = randomGenerator(20261107);
const extrapolation = Array.from({ length: 250 }, () =>
  examples(101 + Math.floor(random() * 20), 101 + Math.floor(random() * 20)),
).flat();
const { estimate } = inference(model);
const reference = (rows: Example[]) =>
  rows.map((row) => ({
    expression: row.expression,
    expected: String(row.answer),
    estimate: estimate(row),
  }));
const reset = { ...model, layers: initialLayers(graph, model.nodes) };
const severed = structuredClone(model);
severed.layers[1].weights.fill(0);
const ablations = {
  resetInternalSynapses: evaluate(validation, inference(reset).estimate),
  severInternalLayer: evaluate(validation, inference(severed).estimate),
};

await writeFile(
  join(output, "reference.json"),
  JSON.stringify({
    validation: reference(validation),
    test: reference(test),
    extrapolation: reference(extrapolation),
  }),
);
await writeFile(
  join(output, "ablations.json"),
  JSON.stringify(ablations, null, 2),
);
console.log(JSON.stringify(ablations));
