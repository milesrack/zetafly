import assert from "node:assert/strict";
import test from "node:test";
import { cachedLoss, trainReadout } from "../scripts/readout-training.ts";
import { decodeArchive, encodeArchive } from "../server/brain/arrays.ts";
import { runPolicy } from "../server/brain/policy.ts";
import { SequenceTrainer } from "../server/brain/sequence-training.ts";

const graph = {
  inputs: [0],
  offsets: new Uint32Array([0, 1, 2, 3]),
  edges: new Uint32Array([0, 1, 2]),
  post: new Uint32Array([1, 2, 0]),
  weights: new Float64Array([1, 0.7, -0.3]),
};
const options = {
  seed: 42,
  sensory: [0],
  readout: [0, 1, 2],
  steps: 2,
  settle: 2,
  maxKeys: 5,
  anatomySha256: "a".repeat(64),
};

test("sequence BPTT includes earlier symbols, neuronal memory, embeddings, gains, and answer keys", () => {
  for (const [coupling, hidden] of [
    [0.25, 0],
    [3, 0],
    [0.25, 3],
    [3, 3],
  ]) {
    const model = new SequenceTrainer(graph, {
      ...options,
      coupling,
      hidden,
      encoding: "place",
    });
    const analytic = model.gradient("2+3", "5");
    const epsilon = 1e-5;

    for (let i = 0; i < model.parameters.length; i++) {
      const saved = model.parameters[i];
      model.parameters[i] = saved + epsilon;
      const upper = model.loss("2+3", "5");
      model.parameters[i] = saved - epsilon;
      const lower = model.loss("2+3", "5");
      model.parameters[i] = saved;

      assert.ok(
        Math.abs(analytic[i] - (upper - lower) / (2 * epsilon)) < 1e-6,
        `parameter ${i}`,
      );
    }

    assert.ok(analytic[model.embeddingStart + 2] !== 0);
    assert.notDeepEqual(model.features("2+3", "5"), model.features("3+2", "5"));
    assert.deepEqual(model.predict("2+3"), model.predict("2+3"));
  }
});

test("numeric decoding preserves neural choices and reserves an end token", () => {
  const model = new SequenceTrainer(graph, options);
  model.parameters.fill(0, model.headStart);
  model.parameters[model.headStart + 9 * 4 + 3] = 10;

  assert.deepEqual(model.predict("17*6"), {
    answer: "9999",
    keys: ["9", "9", "9", "9", "Enter"],
    terminated: true,
  });

  model.parameters.fill(0, model.headStart);
  model.parameters[model.headStart + 11 * 4 + 3] = 10;

  assert.deepEqual(model.predict("17*6"), {
    answer: "0",
    keys: ["0", "Enter"],
    terminated: true,
  });

  assert.throws(() => model.predict("17**6"));
  assert.throws(() => model.loss("2+3", "NaN"));
});

test("sequence checkpoints preserve optimiser state and frozen training changes only the head", () => {
  const model = new SequenceTrainer(graph, options);
  const rows = [
    { expression: "0+0", answer: "1" },
    { expression: "0*0", answer: "2" },
  ];
  const before = model.parameters.slice(0, model.headStart);
  model.learn(rows, 0.01, "head");
  assert.deepEqual(model.parameters.slice(0, model.headStart), before);
  assert.equal(model.internalUpdates, 0);
  model.learn(rows, 0.01);
  assert.notDeepEqual(model.parameters.slice(0, model.headStart), before);
  const restored = SequenceTrainer.restore(graph, model.checkpoint());
  assert.deepEqual(restored.predict("0+0"), model.predict("0+0"));
  model.learn(rows, 0.01);
  restored.learn(rows, 0.01);
  assert.deepEqual(restored.parameters, model.parameters);
  const initialLoss = model.loss("0+0", "1") + model.loss("0*0", "2");

  for (let i = 0; i < 1500; i++) {
    model.learn(rows, 0.01);
  }

  assert.ok(
    model.loss("0+0", "1") + model.loss("0*0", "2") < initialLoss * 0.25,
  );

  assert.equal(model.predict("0+0").answer, "1");
  assert.equal(model.predict("0*0").answer, "2");

  assert.throws(
    () =>
      SequenceTrainer.restore(
        { ...graph, weights: new Float64Array([0, 0, 0]) },
        model.checkpoint(),
      ),
    /graph/i,
  );
});

test("sequence coupling changes signal propagation and survives checkpoint restoration", () => {
  const baseline = new SequenceTrainer(graph, options);
  const stronger = new SequenceTrainer(graph, { ...options, coupling: 3 });

  assert.notDeepEqual(
    stronger.features("2+3", "5"),
    baseline.features("2+3", "5"),
  );

  const restored = SequenceTrainer.restore(graph, stronger.checkpoint());
  assert.equal(restored.options.coupling, 3);

  assert.deepEqual(
    restored.features("2+3", "5"),
    stronger.features("2+3", "5"),
  );

  assert.throws(
    () => new SequenceTrainer(graph, { ...options, coupling: Number.NaN }),
  );
});

test("legacy sequence checkpoints retain the original recurrent scaling", () => {
  const model = new SequenceTrainer(graph, options);
  const arrays = Object.fromEntries(
    Object.entries(decodeArchive(model.checkpoint())).map(([name, row]) => {
      if (row.dtype === "U") {
        throw Error("Unexpected string");
      }

      return [
        name,
        {
          data: row.data,
          shape: row.shape,
          dtype: `<${row.dtype}${row.width}`,
        },
      ];
    }),
  );
  const legacy = encodeArchive({
    ...arrays,
    format_version: { data: 7 },
    config: {
      data: [options.seed, options.steps, options.settle, options.maxKeys],
      shape: [4],
      dtype: "<f8",
    },
  });
  const restored = SequenceTrainer.restore(graph, legacy);
  assert.equal(restored.options.coupling, 0.25);
  assert.deepEqual(restored.predict("17*6"), model.predict("17*6"));
});

test("sequence propagation is invariant to sparse-edge storage order", () => {
  const reordered = {
    ...graph,
    edges: new Uint32Array([1, 2, 0]),
    post: new Uint32Array([0, 1, 2]),
    weights: new Float64Array([-0.3, 1, 0.7]),
  };
  const a = new SequenceTrainer(graph, { ...options, coupling: 3 });
  const b = new SequenceTrainer(reordered, { ...options, coupling: 3 });
  assert.deepEqual(a.features("17*6", "102"), b.features("17*6", "102"));
  assert.deepEqual(a.gradient("17*6", "102"), b.gradient("17*6", "102"));
});

test("place encoding trains the shared positional projection and round-trips without state leakage", () => {
  const model = new SequenceTrainer(graph, { ...options, encoding: "place" });
  const analytic = model.gradient("12+3", "15");
  const epsilon = 1e-5;

  for (let i = 0; i < model.parameters.length; i++) {
    const saved = model.parameters[i];
    model.parameters[i] = saved + epsilon;
    const upper = model.loss("12+3", "15");
    model.parameters[i] = saved - epsilon;
    const lower = model.loss("12+3", "15");
    model.parameters[i] = saved;

    assert.ok(
      Math.abs(analytic[i] - (upper - lower) / (2 * epsilon)) < 1e-6,
      `parameter ${i}`,
    );
  }

  assert.ok(
    analytic
      .subarray(model.positionStart, model.headStart)
      .some((v) => Math.abs(v) > 1e-12),
  );

  assert.throws(() => model.nextAction(), /active problem/);
  model.beginProblem("1000+25");
  const first = model.nextAction();
  model.beginProblem("2*3");
  model.nextAction();
  model.beginProblem("1000+25");
  assert.equal(model.nextAction(), first);
  assert.throws(() => model.beginProblem("1000**25"));
  assert.throws(() => model.nextAction(), /active problem/);
  const restored = SequenceTrainer.restore(graph, model.checkpoint());
  assert.equal(restored.options.encoding, "place");
  assert.deepEqual(restored.predict("1000+25"), model.predict("1000+25"));
  model.learn([{ expression: "12+3", answer: "15" }]);
  restored.learn([{ expression: "12+3", answer: "15" }]);
  assert.deepEqual(restored.parameters, model.parameters);
});

test("one exported model accepts different operand lengths without changing its parameters", () => {
  const model = new SequenceTrainer(graph, {
    ...options,
    encoding: "place",
    maxKeys: 26,
  });
  const restored = SequenceTrainer.restore(graph, model.checkpoint());
  assert.deepEqual(restored.limits, { maxKeys: 26 });
  const parameters = restored.parameters.slice();

  for (const expression of [
    "1+2",
    "1000+25",
    "123456789012+25",
    `${"9".repeat(50)}*25`,
  ]) {
    assert.deepEqual(restored.predict(expression), model.predict(expression));
  }

  assert.deepEqual(restored.parameters, parameters);

  assert.throws(
    () => restored.predict(`${"9".repeat(256)}+1`),
    /request limit/,
  );
});

test("numeric decoding masks empty answers, misplaced signs, and unsafe integers without solving the expression", () => {
  for (const maxKeys of [2, 3, 5, 32]) {
    const model = new SequenceTrainer(graph, { ...options, maxKeys });
    const width = options.readout.length + 1;
    model.parameters.fill(0, model.headStart);
    model.parameters[model.headStart + 10 * width + width - 1] = 10;
    const signed = model.predict("17*6");
    assert.match(signed.answer, /^-?\d+$/);
    assert.equal(signed.terminated, true);
    assert.ok(signed.keys.length <= maxKeys);
    assert.equal(signed.answer.includes("-", 1), false);
    model.parameters.fill(0, model.headStart);
    model.parameters[model.headStart + 9 * width + width - 1] = 10;
    const digits = model.predict("17*6");
    assert.ok(Number.isSafeInteger(Number(digits.answer)));
    assert.equal(digits.terminated, true);
    assert.notEqual(digits.answer, "102");
    model.parameters.fill(0, model.headStart);
    model.parameters[model.headStart + 7 * width + width - 1] = 2;
    model.parameters[model.headStart + 11 * width + width - 1] = 3;
    assert.equal(model.predict("17*6").answer, "7");
    assert.equal(model.predict("1+1").answer, "7");
  }
});

test("rejected numeric answers are excluded without changing the model or leaking into another problem", () => {
  const model = new SequenceTrainer(graph, { ...options, maxKeys: 3 });
  model.parameters.fill(0, model.headStart);
  model.parameters[model.headStart + 5 * 4 + 3] = 8;
  model.parameters[model.headStart + 6 * 4 + 3] = 7;
  model.parameters[model.headStart + 11 * 4 + 3] = 10;
  const parameters = model.parameters.slice();

  assert.equal(runPolicy(model, "3*56").answer, "5");
  const retry = runPolicy(model, "3*56", undefined, ["005"]);
  assert.notEqual(Number(retry.answer), 5);
  assert.equal(retry.answer.length, 1);
  const third = runPolicy(model, "3*56", undefined, ["5", retry.answer]);
  assert.notEqual(Number(third.answer), 5);
  assert.notEqual(Number(third.answer), Number(retry.answer));
  assert.equal(third.terminated, true);
  assert.deepEqual(model.parameters, parameters);
  assert.equal(runPolicy(model, "82-45").answer, "5");
  assert.throws(() => model.beginProblem("3*56", ["NaN"]));
  assert.throws(() => model.beginProblem("3*56", Array(513).fill("5")));
});

test("nonlinear readouts train, preserve frozen neurons, and restore both prediction and optimiser state", () => {
  const model = new SequenceTrainer(graph, {
    ...options,
    encoding: "place",
    hidden: 8,
  });
  const examples = [
    { expression: "2+3", answer: "5" },
    { expression: "3*2", answer: "6" },
  ];
  const rows = examples.flatMap((r) => model.features(r.expression, r.answer));
  model.calibrate(rows);
  const before = model.parameters.slice(0, model.headStart);
  const loss = () => rows.reduce((sum, row) => sum + model.featureLoss(row), 0);
  const initial = loss();

  for (let i = 0; i < 1500; i++) {
    model.learnFeatures(rows, 0.003);
  }

  assert.ok(loss() < initial / 4);
  assert.deepEqual(model.parameters.slice(0, model.headStart), before);
  assert.equal(model.predict("2+3").answer, "5");
  assert.equal(model.predict("3*2").answer, "6");
  const restored = SequenceTrainer.restore(graph, model.checkpoint());
  assert.equal(restored.options.hidden, 8);
  assert.deepEqual(restored.predict("2+3"), model.predict("2+3"));
  model.learn(examples, 0.0001);
  restored.learn(examples, 0.0001);
  assert.deepEqual(restored.parameters, model.parameters);
});

test("training callbacks provide a restorable best checkpoint during the run", () => {
  const model = new SequenceTrainer(graph, options);
  const rows = [model.features("2+3", "5"), model.features("3*2", "6")];
  let validations = 0;
  let best = Infinity;
  const result = trainReadout(
    model,
    rows,
    rows,
    { updates: 20, batch: 4, rate: 0.003, validateEvery: 5, patience: null },
    () => 0.25,
    {
      onValidation: (row, checkpoint) => {
        validations++;
        best = Math.min(best, row.loss);
        const restored = SequenceTrainer.restore(graph, checkpoint);
        assert.ok(cachedLoss(restored, rows, [1, 2]) <= best + 1e-12);
      },
      validationWeights: [1, 2],
    },
  );

  assert.equal(validations, 4);
  assert.ok(Number.isFinite(result.loss));
  assert.equal(
    cachedLoss(SequenceTrainer.restore(graph, result.checkpoint), rows, [1, 2]),
    result.loss,
  );
});
