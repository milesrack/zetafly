import { POSITION_FEATURES } from "./expression.ts";
import { backpropReadout } from "./readout.ts";
import {
  type Frame,
  type KeyExample,
  OUTPUTS,
  SequenceBrain,
  type SequenceExample,
} from "./sequence.ts";

export class SequenceTrainer extends SequenceBrain {
  calibrate(rows: KeyExample[]) {
    if (
      !rows.length ||
      rows.some(
        (r) =>
          r.features.length !== this.mean.length ||
          r.features.some((v) => !Number.isFinite(v)),
      )
    ) {
      throw Error("Invalid calibration data");
    }

    for (let i = 0; i < this.mean.length; i++) {
      this.mean[i] = rows.reduce((s, r) => s + r.features[i], 0) / rows.length;

      this.scale[i] = Math.max(
        1e-6,
        Math.sqrt(
          rows.reduce((s, r) => s + (r.features[i] - this.mean[i]) ** 2, 0) /
            rows.length,
        ),
      );
    }
  }

  private headGradient(
    row: KeyExample,
    result: Float64Array,
    divisor = 1,
    backprop = false,
  ) {
    if (
      !Number.isInteger(row.key) ||
      row.key < 0 ||
      row.key >= OUTPUTS.length
    ) {
      throw Error("Invalid target key");
    }

    const pass = this.readout(row.features);
    const logits = pass.logits;
    const maximum = Math.max(...logits);
    const values = Float64Array.from(logits, (v) => Math.exp(v - maximum));
    const total = values.reduce((s, v) => s + v, 0);
    const deltas = Float64Array.from(
      values,
      (value, key) => (value / total - Number(key === row.key)) / divisor,
    );
    const inputError = backpropReadout(
      this.parameters,
      this.headStart,
      pass,
      deltas,
      result,
    );
    const error = new Float64Array(backprop ? this.population : 0);

    if (backprop) {
      for (let i = 0; i < row.features.length; i++) {
        error[this.options.readout[i]] += inputError[i] / this.scale[i];
      }
    }

    return error;
  }

  gradient(expression: string, answer: string) {
    const frames: Frame[] = [];
    const rows = this.teacher(expression, answer, frames);
    const result = new Float64Array(this.parameters.length);
    const n = this.population;
    const errors = new Map(
      rows.map((row) => [
        row.frame,
        this.headGradient(row, result, rows.length, true),
      ]),
    );
    let error = new Float64Array(n);
    const { offsets } = this.graph;

    for (let t = frames.length - 1; t >= 0; t--) {
      const observed = errors.get(t + 1);

      if (observed) {
        for (let i = 0; i < n; i++) {
          error[i] += observed[i];
        }
      }

      const { token, position, previous, sums, activation } = frames[t];
      const preceding = new Float64Array(n);
      const delta = new Float64Array(n);

      for (let i = 0; i < n; i++) {
        const retention = 1 / (1 + Math.exp(-this.parameters[n + i]));
        const local = error[i] * (1 - retention) * (1 - activation[i] ** 2);
        result[i] += local * sums[i];

        result[n + i] +=
          error[i] *
          (previous[i] - activation[i]) *
          retention *
          (1 - retention);

        preceding[i] = error[i] * retention;
        delta[i] = local * this.parameters[i];
      }

      if (token >= 0) {
        for (let i = 0; i < this.options.sensory.length; i++) {
          result[
            this.embeddingStart + token * this.options.sensory.length + i
          ] += delta[this.options.sensory[i]];
        }
      }

      if (position) {
        for (let i = 0; i < this.options.sensory.length; i++) {
          for (let j = 0; j < POSITION_FEATURES; j++) {
            result[this.positionStart + j * this.options.sensory.length + i] +=
              delta[this.options.sensory[i]] * position[j];
          }
        }
      }

      for (let source = 0; source < n; source++) {
        for (let c = offsets[source]; c < offsets[source + 1]; c++) {
          preceding[source] += delta[this.targets[c]] * this.weights[c];
        }
      }

      error = preceding;
    }

    return result;
  }

  private update(gradient: Float64Array, rate: number, mode: "joint" | "head") {
    if (this.first.length !== this.parameters.length) {
      throw Error("Warm-start inference weights before training");
    }

    if (
      !Number.isFinite(rate) ||
      rate <= 0 ||
      rate > 0.1 ||
      gradient.some((v) => !Number.isFinite(v))
    ) {
      throw Error("Invalid sequence update");
    }

    this.headUpdates++;

    if (mode === "joint") {
      this.internalUpdates++;
    }

    for (
      let i = mode === "head" ? this.headStart : 0;
      i < gradient.length;
      i++
    ) {
      const g = Math.max(-1, Math.min(1, gradient[i]));
      const age = i < this.headStart ? this.internalUpdates : this.headUpdates;
      this.first[i] = 0.9 * this.first[i] + 0.1 * g;
      this.second[i] = 0.999 * this.second[i] + 0.001 * g * g;

      this.parameters[i] -=
        (rate * (this.first[i] / (1 - 0.9 ** age))) /
        (Math.sqrt(this.second[i] / (1 - 0.999 ** age)) + 1e-8);

      if (i < this.population) {
        this.parameters[i] = Math.max(0.1, Math.min(4, this.parameters[i]));
      } else {
        this.parameters[i] = Math.max(-10, Math.min(10, this.parameters[i]));
      }
    }
  }

  learnFeatures(rows: KeyExample[], rate = 0.003) {
    if (!rows.length) {
      throw Error("Empty sequence batch");
    }

    const gradient = new Float64Array(this.parameters.length);

    for (const row of rows) {
      this.headGradient(row, gradient, rows.length);
    }

    this.update(gradient, rate, "head");
  }

  learn(
    rows: SequenceExample[],
    rate = 0.003,
    mode: "joint" | "head" = "joint",
  ) {
    if (!rows.length) {
      throw Error("Empty sequence batch");
    }

    if (mode === "head") {
      return this.learnFeatures(
        rows.flatMap((r) => this.features(r.expression, r.answer)),
        rate,
      );
    }

    const gradient = new Float64Array(this.parameters.length);

    for (const row of rows) {
      const sample = this.gradient(row.expression, row.answer);

      for (let i = 0; i < gradient.length; i++) {
        gradient[i] += sample[i] / rows.length;
      }
    }

    this.update(gradient, rate, mode);
  }
}
