import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { loadGraph } from "../server/brain/graph.ts";
import { Brain } from "../server/brain/model.ts";
import { weightsMetadata } from "../server/brain/weights.ts";

const { values } = parseArgs({
  options: { input: { type: "string" }, output: { type: "string" } },
});
if (!values.input || !values.output?.endsWith(".npz")) {
  throw Error("Use --input weights.json --output new-checkpoint.npz");
}
const brain = new Brain(
  await loadGraph(),
  JSON.parse(await readFile(values.input, "utf8")),
);
const bytes = brain.checkpoint();
await writeFile(values.output, bytes, { flag: "wx" });
console.log(
  JSON.stringify({
    path: values.output,
    bytes: bytes.length,
    ...weightsMetadata(bytes),
  }),
);
