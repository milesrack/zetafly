import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { sha256 } from "../../server/brain/graph.ts";
import type { BrainCheckpoint } from "../../server/brain/model.ts";
import { Brain } from "../../server/brain/model.ts";
import { prepareCircuit } from "./circuit.ts";
import {
  evaluate,
  inference,
  randomGenerator,
  scales,
  splitExamples,
  trainer,
} from "./model.ts";
import { cutoffs, fitReadout } from "./readout.ts";

const { values } = parseArgs({
  options: {
    output: { type: "string" },
    steps: { type: "string", default: "20000" },
    seconds: { type: "string", default: "60" },
  },
});
const stepLimit = Number(values.steps);
const seconds = Number(values.seconds);
const output = values.output;
if (
  !output ||
  !Number.isInteger(stepLimit) ||
  stepLimit < 100 ||
  stepLimit > 20000 ||
  !Number.isFinite(seconds) ||
  seconds <= 0 ||
  seconds > 300
) {
  throw Error(
    "Provide --output, 100–20000 steps and a positive training budget of at most 300 seconds",
  );
}
await mkdir(join(output, ".."), { recursive: true });
await mkdir(output);
const started = performance.now();
const { graph, nodes, layers, graphHashes } = await prepareCircuit();
const [train, validation, test] = splitExamples();
const random = randomGenerator(42);
const initialise = (width: number) => (2 * random() - 1) / Math.sqrt(width);
let model: BrainCheckpoint = {
  format: "fly-brain-v1",
  nodes,
  layers,
  graphHashes,
  encoder: nodes[0].map(() => Array.from({ length: 6 }, () => initialise(6))),
  encoderBias: nodes[0].map(() => initialise(6)),
  decoder: scales.map(() => nodes[3].map(() => initialise(nodes[3].length))),
  decoderBias: scales.map(() => initialise(nodes[3].length)),
};
const update = trainer(model, random);
const { estimate } = inference(model);
let best = evaluate(validation, estimate);
let checkpoint = structuredClone(model);
let selected = 0;
const trainingCurve = [];
const trainingStarted = performance.now();
for (let step = 1; step <= stepLimit; step++) {
  update(train, step);
  const budgetReached = performance.now() - trainingStarted >= seconds * 1000;
  if (step % 100 === 0 || budgetReached || step === stepLimit) {
    const result = evaluate(validation, estimate);
    trainingCurve.push({ step, ...result });
    if (result.loss < best.loss) {
      best = result;
      checkpoint = structuredClone(model);
      selected = step;
    }
    if (step % 1000 === 0) {
      console.log(
        JSON.stringify({ step, correct: result.correct, total: result.total }),
      );
    }
    if (budgetReached || step - selected >= 5000) {
      break;
    }
  }
}

model = checkpoint;
const selectedModel = inference(model);
const fitted = scales.map((scale, operation) => {
  const rows = train.filter((row) => row.operation === operation);
  return fitReadout(
    rows.map((row) => [...selectedModel.activity(row), 1]),
    rows.map((row) => row.answer / scale),
  );
});
let bestHead: ReturnType<typeof evaluate> | undefined;
const headSelection = cutoffs.map((cutoff, index) => {
  const coefficients = fitted.map((fits) => fits[index]);
  model.decoder = coefficients.map((row) => row.slice(0, -1));
  model.decoderBias = coefficients.map((row) => row.at(-1)!);
  const result = evaluate(validation, selectedModel.estimate);
  if (!bestHead || result.correct > bestHead.correct) {
    bestHead = result;
    checkpoint = structuredClone(model);
  }
  return {
    cutoff,
    coefficientNorms: coefficients.map((row) => Math.hypot(...row)),
    ...result,
  };
});

const sourceDirectory = "research/connectome-arithmetic";
const sourceHashes: Record<string, string> = {};
for (const file of (await readdir(sourceDirectory)).sort()) {
  if (file.endsWith(".ts")) {
    const path = join(sourceDirectory, file);
    sourceHashes[path] = sha256(await readFile(path));
  }
}

const report = {
  scope:
    "Learnt feed-forward subcircuit of actual fly connections, not a full recurrent or biophysical fly brain",
  seed: 42,
  dtype: "float64 inference",
  trainingExamples: train.length,
  neurons: nodes.map((layer) => layer.length),
  connections: layers.map((layer) => layer.weights.length),
  selectedTrainingStep: selected,
  trainingCurve,
  headSelection,
  validation: bestHead,
  test: evaluate(test, inference(checkpoint).estimate),
  seconds: (performance.now() - started) / 1000,
  node: process.version,
  sourceHashes,
};

const bytes = new Brain(graph, checkpoint).checkpoint();
await writeFile(join(output, "weights.json"), JSON.stringify(checkpoint));
await writeFile(join(output, "weights.npz"), bytes);
await writeFile(
  join(output, "evaluation.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    validation: report.validation,
    test: report.test,
    seconds: report.seconds,
  }),
);
