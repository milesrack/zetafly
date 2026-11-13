import type { BrainCheckpoint } from "../../server/brain/model.ts";

export const symbols = "+-*/";
export const scales = [200, 100, 10000, 100];

export function examples(a: number, b: number) {
  return [
    [a, b, 0, a + b],
    [a + b, a, 1, b],
    [a, b, 2, a * b],
    [a * b, a, 3, b],
  ].map(([a, b, operation, answer]) => ({
    expression: `${a}${symbols[operation]}${b}`,
    operation,
    answer,
    input: [
      Math.fround(a / [100, 200, 100, 10000][operation]),
      Math.fround(b / 100),
      ...Array.from({ length: 4 }, (_, i) => Number(i === operation)),
    ],
  }));
}
export type Example = ReturnType<typeof examples>[number];

export function splitExamples() {
  const banks: [Example[], Example[], Example[]] = [[], [], []];
  for (let a = 2; a <= 100; a++) {
    for (let b = 2; b <= 100; b++) {
      let hash = 2166136261;
      for (const symbol of `${Math.min(a, b)}:${Math.max(a, b)}`) {
        hash = Math.imul(hash ^ symbol.charCodeAt(0), 16777619) >>> 0;
      }
      banks[Math.min(2, Math.max(0, (hash % 10) - 7))].push(...examples(a, b));
    }
  }
  return banks;
}

export function randomGenerator(seed: number) {
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 2 ** 32;
  };
}

function dot(weights: number[], input: number[], bias: number) {
  for (let i = 0; i < weights.length; i++) {
    bias += weights[i] * input[i];
  }
  return bias;
}

function forward(model: BrainCheckpoint, input: number[], states: number[][]) {
  for (let i = 0; i < model.encoder.length; i++) {
    states[0][i] = Math.tanh(
      dot(model.encoder[i], input, model.encoderBias[i]),
    );
  }
  for (const [index, layer] of model.layers.entries()) {
    const before = states[index];
    const after = states[index + 1];
    for (let i = 0; i < after.length; i++) {
      after[i] = layer.bias[i];
    }
    for (let i = 0; i < layer.weights.length; i++) {
      after[layer.targets[i]] += before[layer.sources[i]] * layer.weights[i];
    }
    for (let i = 0; i < after.length; i++) {
      after[i] = Math.tanh(after[i]);
    }
  }
  return states[3];
}

export function inference(model: BrainCheckpoint) {
  const states = model.nodes.map((nodes) => nodes.map(() => 0));
  return {
    activity: (row: Example) => [...forward(model, row.input, states)],
    estimate: (row: Example) =>
      dot(
        model.decoder[row.operation],
        forward(model, row.input, states),
        model.decoderBias[row.operation],
      ) * scales[row.operation],
  };
}

export function evaluate(rows: Example[], estimate: (row: Example) => number) {
  const metrics = Array.from({ length: 4 }, () => ({
    correct: 0,
    total: 0,
    absoluteError: 0,
  }));
  let loss = 0;
  let withinThreeCandidates = 0;
  for (const row of rows) {
    const value = estimate(row);
    const error = Math.abs(value - row.answer);
    const metric = metrics[row.operation];
    metric.total++;
    metric.absoluteError += error;
    metric.correct += Number(error < 0.5);
    loss += (error / scales[row.operation]) ** 2;
    withinThreeCandidates += Number(
      Math.abs(Math.round(value) - row.answer) <= 1,
    );
  }
  return {
    correct: metrics.reduce((sum, metric) => sum + metric.correct, 0),
    total: rows.length,
    loss: loss / rows.length,
    withinThreeCandidates,
    byOperation: Object.fromEntries(
      metrics.map(({ correct, total, absoluteError }, i) => [
        symbols[i],
        { correct, total, meanAbsoluteError: absoluteError / total },
      ]),
    ),
  };
}

function parameter(values: number[]) {
  return {
    values,
    gradient: new Float64Array(values.length),
    mean: new Float64Array(values.length),
    variance: new Float64Array(values.length),
  };
}

export function trainer(model: BrainCheckpoint, random: () => number) {
  const states = model.nodes.map((nodes) => nodes.map(() => 0));
  const deltas = states.map((state) => new Float64Array(state.length));
  const encoder = model.encoder.map(parameter);
  const encoderBias = parameter(model.encoderBias);
  const decoder = model.decoder.map(parameter);
  const decoderBias = parameter(model.decoderBias);
  const layers = model.layers.map((layer) => ({
    ...layer,
    biasParameter: parameter(layer.bias),
    sign: layer.weights.map(Math.sign),
    log: parameter(layer.weights.map((weight) => Math.log(Math.abs(weight)))),
  }));
  const parameters = [
    ...encoder,
    encoderBias,
    ...decoder,
    decoderBias,
    ...layers.flatMap((layer) => [layer.log, layer.biasParameter]),
  ];

  return (rows: Example[], step: number, batchSize = 256) => {
    for (let sample = 0; sample < batchSize; sample++) {
      const { input, answer, operation } =
        rows[Math.floor(random() * rows.length)];
      const motor = forward(model, input, states);
      const error =
        dot(model.decoder[operation], motor, model.decoderBias[operation]) -
        Math.fround(answer / scales[operation]);
      const gradient = (2 * error) / batchSize;
      decoderBias.gradient[operation] += gradient;
      for (let i = 0; i < motor.length; i++) {
        decoder[operation].gradient[i] += gradient * motor[i];
        deltas[3][i] = gradient * model.decoder[operation][i];
      }

      for (let index = layers.length - 1; index >= 0; index--) {
        const layer = layers[index];
        const after = deltas[index + 1];
        const before = deltas[index];
        before.fill(0);
        for (let i = 0; i < after.length; i++) {
          after[i] *= 1 - states[index + 1][i] ** 2;
          layer.biasParameter.gradient[i] += after[i];
        }
        for (let i = 0; i < layer.weights.length; i++) {
          const source = layer.sources[i];
          const delta = after[layer.targets[i]] * layer.weights[i];
          const log = layer.log.values[i];
          before[source] += delta;
          if (log >= -14 && log <= 3) {
            layer.log.gradient[i] += delta * states[index][source];
          }
        }
      }

      for (let i = 0; i < encoder.length; i++) {
        const delta = deltas[0][i] * (1 - states[0][i] ** 2);
        encoderBias.gradient[i] += delta;
        for (let j = 0; j < input.length; j++) {
          encoder[i].gradient[j] += delta * input[j];
        }
      }
    }

    let squaredNorm = 0;
    for (const { gradient } of parameters) {
      for (const value of gradient) {
        squaredNorm += value * value;
      }
    }
    const clip = Math.min(1, 1 / (Math.sqrt(squaredNorm) + 1e-6));
    const meanCorrection = 1 - 0.9 ** step;
    const varianceCorrection = 1 - 0.999 ** step;
    for (const { values, gradient, mean, variance } of parameters) {
      for (let i = 0; i < values.length; i++) {
        const value = gradient[i] * clip;
        mean[i] = 0.9 * mean[i] + 0.1 * value;
        variance[i] = 0.999 * variance[i] + 0.001 * value * value;
        values[i] -=
          (0.003 * (mean[i] / meanCorrection)) /
          (Math.sqrt(variance[i] / varianceCorrection) + 1e-8);
        gradient[i] = 0;
      }
    }
    for (const { weights, sign, log } of layers) {
      for (let i = 0; i < weights.length; i++) {
        weights[i] =
          sign[i] * Math.exp(Math.max(-14, Math.min(3, log.values[i])));
      }
    }
  };
}
