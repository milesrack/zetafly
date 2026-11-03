import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { loadAnatomy } from "../server/brain/anatomy.ts";
import { loadGraph, sha256 } from "../server/brain/graph.ts";
import { randomSource } from "../server/brain/random.ts";
import type { SequenceExample } from "../server/brain/sequence.ts";
import { SequenceTrainer } from "../server/brain/sequence-training.ts";
import { cacheSequenceFeatures } from "./feature-cache.ts";
import { cachedLoss, trainReadout } from "./readout-training.ts";
import {
  memorizationSplit,
  sequenceProtocol,
  sequenceSplit,
} from "./sequence-data.ts";

const { values } = parseArgs({
  options: {
    "max-keys": { type: "string" },
    encoding: { type: "string", default: "place" },
    hidden: { type: "string", default: "128" },
    curriculum: { type: "string", default: "zetamac" },
    initial: { type: "string" },
    "freeze-brain": { type: "boolean", default: false },
    "full-data": { type: "boolean", default: false },
    "memorize-defaults": { type: "boolean", default: false },
    "memorize-examples": { type: "string" },
    workers: { type: "string", default: "1" },
    "feature-cache": { type: "string" },
    updates: { type: "string" },
    "batch-size": { type: "string" },
    "refinement-updates": { type: "string" },
    "refinement-batch-size": { type: "string" },
    "validate-every": { type: "string" },
    patience: { type: "string" },
    schedule: { type: "string", default: "gentle" },
    seed: { type: "string", default: "42" },
    output: { type: "string" },
  },
});

if (!["symbols", "place"].includes(values.encoding!)) {
  throw Error("Use --encoding symbols or place");
}

const hidden = Number(values.hidden);

if (
  !Number.isInteger(hidden) ||
  hidden < 0 ||
  hidden > 256 ||
  (hidden > 0 && values.encoding !== "place")
) {
  throw Error(
    "Use --hidden 0–256; nonlinear readouts require --encoding place",
  );
}

if (!["digits", "zetamac"].includes(values.curriculum!)) {
  throw Error("Use --curriculum digits or zetamac");
}

const count = (name: string, fallback: number) => {
  const value = Number(values[name as keyof typeof values] ?? fallback);

  if (!Number.isSafeInteger(value) || value < 1 || value > 1000000) {
    throw Error(`Use --${name} 1–1000000`);
  }

  return value;
};

const initialBytes = values.initial
  ? await readFile(values.initial)
  : undefined;
const schedule = sequenceProtocol(values.schedule!);
const protocol = {
  ...schedule,
  version: 5,
  evaluationScope: values["memorize-defaults"]
    ? "in_sample_memorisation"
    : "held_out",
  curriculum: values.curriculum,
  fullData:
    values["full-data"] ||
    (values["memorize-defaults"] && !values["memorize-examples"]),
  workers: count("workers", 1),
  memorizationExamples: values["memorize-examples"]
    ? Number(values["memorize-examples"])
    : null,
  sampling: "uniform_operation_then_example_then_key",
  selection: {
    ...schedule.selection,
    metric: "operation_balanced_validation_cross_entropy",
  },
  initialSha256: initialBytes ? sha256(initialBytes) : null,
  warmup: {
    updates: count("updates", hidden ? 1500 : schedule.warmup.updates),
    batch: count("batch-size", hidden ? 128 : schedule.warmup.batch),
    rate: hidden ? 0.0005 : schedule.warmup.rate,
    validateEvery: count(
      "validate-every",
      hidden ? 50 : schedule.warmup.validateEvery,
    ),
    patience: count("patience", 300),
  },
  refinement: {
    ...schedule.refinement,
    updates: values["freeze-brain"]
      ? 0
      : count("refinement-updates", schedule.refinement.updates),
    batch: count("refinement-batch-size", schedule.refinement.batch),
    validateEvery: count("validate-every", schedule.refinement.validateEvery),
  },
  inputEncoding: values.encoding,
  brain: {
    ...schedule.brain,
    hidden,
    maxKeys: Number(values["max-keys"] ?? schedule.brain.maxKeys),
  },
};
const seed = Number(values.seed);
const output = values.output;

if (
  !Number.isInteger(seed) ||
  seed < 0 ||
  seed > 0xffffffff ||
  !output?.endsWith(".npz")
) {
  throw Error("Use --seed uint32 --output new-checkpoint.npz");
}

if (values["memorize-examples"] && !values["memorize-defaults"]) {
  throw Error("Use --memorize-examples with --memorize-defaults");
}
if (values["memorize-defaults"] && values.curriculum !== "zetamac") {
  throw Error("Default memorisation requires --curriculum zetamac");
}

const reportPath = `${output.slice(0, -4)}.json`;
const latest = output.replace(/\.npz$/, ".latest.npz");
const frozenPath = output.replace(/\.npz$/, ".frozen.npz");

for (const path of [output, reportPath, latest, frozenPath]) {
  try {
    await stat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      continue;
    }

    throw error;
  }

  throw Error(`Choose a new output file: ${path}`);
}

const save = (checkpoint: Uint8Array) => {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(`${latest}.tmp`, checkpoint);
  renameSync(`${latest}.tmp`, latest);
};

const sources = Object.fromEntries(
  await Promise.all(
    [
      "server/brain/sequence.ts",
      "server/brain/sequence-training.ts",
      "server/brain/readout.ts",
      "server/brain/random.ts",
      "scripts/readout-training.ts",
      "scripts/feature-cache.ts",
      "shared/settings.ts",
      "server/brain/policy.ts",
      "server/brain/expression.ts",
      "server/brain/anatomy.ts",
      "scripts/train-sequence.ts",
      "package-lock.json",
      "scripts/sequence-data.ts",
      "scripts/arithmetic-data.ts",
    ].map(async (path) => [path, sha256(await readFile(path))]),
  ),
);
const protocolCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const started = performance.now();
const graph = await loadGraph();
const anatomy = await loadAnatomy();
const data = values["memorize-defaults"]
  ? memorizationSplit(
      values["memorize-examples"]
        ? Number(values["memorize-examples"])
        : undefined,
    )
  : sequenceSplit(values.curriculum, values["full-data"]);
const model = new SequenceTrainer(graph, {
  ...protocol.brain,
  encoding: values.encoding as "symbols" | "place",
  seed,
  sensory: anatomy.sensory,
  readout: anatomy.readout,
  anatomySha256: sha256(
    Buffer.from(
      JSON.stringify({
        annotations: anatomy.annotationSha256,
        order: anatomy.neuronOrderSha256,
        sensory: anatomy.sensory,
        readout: anatomy.readout,
      }),
    ),
  ),
});
let preserveReadout = false;
if (initialBytes) {
  const initial = SequenceTrainer.restore(graph, initialBytes, {
    inference: true,
  });

  if (
    initial.headStart !== model.headStart ||
    initial.options.anatomySha256 !== model.options.anatomySha256 ||
    JSON.stringify(initial.options.sensory) !==
      JSON.stringify(model.options.sensory) ||
    JSON.stringify(initial.options.readout) !==
      JSON.stringify(model.options.readout)
  ) {
    throw Error("Initial checkpoint uses different input or readout anatomy");
  }

  preserveReadout = initial.options.hidden === model.options.hidden;
  if (preserveReadout) {
    model.mean.set(initial.mean);
    model.scale.set(initial.scale);
  }
  model.parameters.set(
    initial.parameters.subarray(
      0,
      initial.options.hidden === model.options.hidden
        ? initial.parameters.length
        : model.headStart,
    ),
  );
}

const initialInternal = model.parameters.slice(0, model.headStart);
save(model.checkpoint());

console.log(
  JSON.stringify({
    phase: "cache",
    population: graph.offsets.length - 1,
    connections: graph.weights.length,
    sensory: anatomy.sensory.length,
    readout: anatomy.readout.length,
    training: data.training.length,
    validation: data.validation.length,
    test: data.test.length,
    protocol,
  }),
);

const cache = (rows: SequenceExample[], name: string) =>
  cacheSequenceFeatures(
    model,
    rows,
    count("workers", 1),
    (completed) => {
      if (completed % 32 === 0 || completed === rows.length) {
        console.log(
          JSON.stringify({ phase: name, completed, total: rows.length }),
        );
      }
    },
    name === "training-cache" && values["feature-cache"]
      ? values["feature-cache"]
      : output.replace(/\.npz$/, `.${name}.cache`),
  );
const training = await cache(data.training, "training-cache");
const cachedTraining = new Map(
  data.training.map((row, i) => [row.expression, training[i]]),
);
const validation = values["memorize-defaults"]
  ? data.validation.map((row) => cachedTraining.get(row.expression)!)
  : await cache(data.validation, "validation-cache");
const activity = { count: 0, squared: 0, nonlinear: 0, saturated: 0 };

for (const row of training.flat()) {
  for (const value of row.features) {
    activity.count++;
    activity.squared += value * value;
    activity.nonlinear += Number(Math.abs(value) > 0.1);
    activity.saturated += Number(Math.abs(value) > 0.95);
  }
}

const trainingActivity = {
  rms: Math.sqrt(activity.squared / activity.count),
  fractionAbovePointOne: activity.nonlinear / activity.count,
  fractionSaturated: activity.saturated / activity.count,
};

console.log(JSON.stringify({ phase: "initial-activity", ...trainingActivity }));

const random = randomSource(seed);
const groups = ["+", "-", "*", "/"].map((operation) =>
  data.training.flatMap((row, index) =>
    row.operation === operation ? [index] : [],
  ),
);
const sampleIndex = () => {
  const group = groups[Math.floor(random() * groups.length)];

  return group[Math.floor(random() * group.length)];
};
const validationCounts = new Map<string, number>();

for (const row of data.validation) {
  validationCounts.set(
    row.operation,
    (validationCounts.get(row.operation) ?? 0) + 1,
  );
}

const validationWeights = data.validation.map(
  (row) => 1 / (4 * validationCounts.get(row.operation)!),
);
const {
  checkpoint: selected,
  loss: best,
  selectedUpdate: warmSelectedUpdate,
  curve: warmCurve,
} = trainReadout(model, training, validation, protocol.warmup, random, {
  onValidation: (row, checkpoint) => {
    save(checkpoint);
    console.log(JSON.stringify({ phase: "warmup", ...row }));
  },
  sample: () => {
    const row = training[sampleIndex()];

    return row[Math.floor(random() * row.length)];
  },
  validationWeights,
  preserveReadout,
});

console.log(
  JSON.stringify({
    phase: "warmup",
    selectedUpdate: warmSelectedUpdate,
    validationLoss: best,
  }),
);

const plastic = SequenceTrainer.restore(graph, selected);
const frozen = SequenceTrainer.restore(graph, selected);
const curve = [{ update: 0, loss: best }];
const frozenCurve = [{ update: 0, loss: best }];
let plasticBest = best;
let frozenBest = best;
let selectedUpdate = 0;
let frozenSelectedUpdate = 0;
let plasticCheckpoint = selected;
let frozenCheckpoint = selected;

for (let update = 1; update <= protocol.refinement.updates; update++) {
  const indices = Array.from(
    { length: protocol.refinement.batch },
    sampleIndex,
  );
  plastic.learn(
    indices.map((index) => data.training[index]),
    protocol.refinement.rate,
  );
  frozen.learnFeatures(
    indices.flatMap((index) => training[index]),
    protocol.refinement.rate,
  );

  if (update % 16 === 0) {
    console.log(
      JSON.stringify({
        phase: "refinement",
        update,
        seconds: (performance.now() - started) / 1000,
      }),
    );
  }

  if (update % protocol.refinement.validateEvery === 0) {
    const loss = data.validation.reduce(
      (sum, row, index) =>
        sum +
        plastic.loss(row.expression, row.answer) * validationWeights[index],
      0,
    );
    const frozenLoss = cachedLoss(frozen, validation, validationWeights);

    if (!Number.isFinite(loss) || !Number.isFinite(frozenLoss)) {
      throw Error("Non-finite refinement loss");
    }

    curve.push({ update, loss });
    frozenCurve.push({ update, loss: frozenLoss });

    if (loss < plasticBest) {
      plasticBest = loss;
      selectedUpdate = update;
      plasticCheckpoint = plastic.checkpoint();
    }

    if (frozenLoss < frozenBest) {
      frozenBest = frozenLoss;
      frozenSelectedUpdate = update;
      frozenCheckpoint = frozen.checkpoint();
    }

    save(plasticCheckpoint);

    console.log(
      JSON.stringify({
        phase: "validation",
        update,
        loss,
        frozenLoss,
        selectedUpdate,
      }),
    );
  }
}

await mkdir(dirname(output), { recursive: true });

await writeFile(output, plasticCheckpoint, { flag: "wx" });
await writeFile(frozenPath, frozenCheckpoint, {
  flag: "wx",
});

const selectedPlastic = SequenceTrainer.restore(graph, plasticCheckpoint);
const selectedFrozen = SequenceTrainer.restore(graph, frozenCheckpoint);
const evaluate = (
  brain: SequenceTrainer,
  rows: typeof data.test,
  name: string,
) => {
  const predictions = rows.map((r, i) => {
    if (i % 64 === 0) {
      console.log(
        JSON.stringify({ phase: name, completed: i, total: rows.length }),
      );
    }

    return brain.predict(r.expression);
  });
  const correct = (i: number) =>
    predictions[i].terminated &&
    Number(predictions[i].answer) === Number(rows[i].answer);

  return {
    correct: predictions.filter((_, i) => correct(i)).length,
    count: rows.length,
    byOperation: Object.fromEntries(
      (["+", "-", "*", "/"] as const).map((op) => {
        const indices = rows.flatMap((r, i) => (r.operation === op ? [i] : []));

        return [
          op,
          { correct: indices.filter(correct).length, count: indices.length },
        ];
      }),
    ),
    predictions,
  };
};
const results = {
  initial: initialBytes
    ? {
        test: evaluate(
          SequenceTrainer.restore(graph, initialBytes, { inference: true }),
          data.test,
          "initial-test",
        ),
      }
    : null,
  plastic: {
    test: evaluate(selectedPlastic, data.test, "plastic-test"),
    extrapolation: evaluate(
      selectedPlastic,
      data.extrapolation,
      "plastic-longer",
    ),
  },
  frozen: values["memorize-defaults"]
    ? null
    : {
        test: evaluate(selectedFrozen, data.test, "frozen-test"),
        extrapolation: evaluate(
          selectedFrozen,
          data.extrapolation,
          "frozen-longer",
        ),
      },
};
const changes = { gains: 0, retention: 0, embeddings: 0 };

for (let i = 0; i < initialInternal.length; i++) {
  if (Math.abs(initialInternal[i] - selectedPlastic.parameters[i]) > 1e-12) {
    changes[
      i < graph.offsets.length - 1
        ? "gains"
        : i < selectedPlastic.embeddingStart
          ? "retention"
          : "embeddings"
    ]++;
  }
}

selectedPlastic.parameters.set(initialInternal);

const resetInternal =
  values["memorize-defaults"] && values["freeze-brain"]
    ? results.plastic.test
    : evaluate(selectedPlastic, data.test, "reset-internal");
const counts = new Map<string, number>();

for (const r of data.training) {
  counts.set(r.answer, (counts.get(r.answer) ?? 0) + 1);
}

const majority = [...counts].sort((a, b) => b[1] - a[1])[0][0];
const report = {
  protocolCommit,
  protocol,
  modelOptions: model.options,
  seed,
  sources,
  graphSha256: model.graphSha256,
  anatomySha256: model.options.anatomySha256,
  population: graph.offsets.length - 1,
  connections: graph.weights.length,
  sensory: anatomy.sensory.length,
  readout: anatomy.readout.length,
  seconds: (performance.now() - started) / 1000,
  trainingActivity,
  warmSelectedUpdate,
  selectedUpdate,
  frozenSelectedUpdate,
  warmCurve,
  curve,
  frozenCurve,
  changes,
  results,
  resetInternal,
  majorityBaseline: {
    answer: majority,
    testCorrect: data.test.filter((r) => r.answer === majority).length,
    testCount: data.test.length,
    extrapolationCorrect: data.extrapolation.filter(
      (r) => r.answer === majority,
    ).length,
    extrapolationCount: data.extrapolation.length,
  },
  data,
  memorization:
    values["memorize-defaults"] && values["freeze-brain"]
      ? {
          poolSize: data.training.length,
          certifiedCorrect: training.filter((keys) =>
            keys.every((row) => selectedPlastic.featureLoss(row) < Math.LN2),
          ).length,
          criterion: "every_target_token_probability_above_one_half",
          exactSampleCorrect: results.plastic.test.correct,
          exactSampleCount: data.test.length,
        }
      : null,
  checkpointSha256: sha256(plasticCheckpoint),
};

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
  flag: "wx",
});

console.log(
  JSON.stringify({
    output,
    seconds: report.seconds,
    selectedUpdate,
    changes,
    scores: Object.fromEntries(
      Object.entries({
        plastic: results.plastic,
        frozen: results.frozen,
      }).flatMap(([key, value]) =>
        value
          ? [
              [
                key,
                {
                  test: value.test.correct,
                  longer: value.extrapolation.correct,
                },
              ],
            ]
          : [],
      ),
    ),
    resetInternal: resetInternal.correct,
    memorization: report.memorization,
    majority,
  }),
);
