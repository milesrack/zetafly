import type { KeyExample, SequenceBrain } from "../server/brain/sequence.ts";
import type { SequenceTrainer } from "../server/brain/sequence-training.ts";

interface Warmup {
  updates: number;
  batch: number;
  rate: number;
  validateEvery: number;
  patience: number | null;
}

interface TrainingOptions {
  onValidation?: (
    row: { update: number; loss: number },
    checkpoint: Uint8Array,
  ) => void;
  sample?: () => KeyExample;
  validationWeights?: number[];
  preserveReadout?: boolean;
}

export function cachedLoss(
  brain: SequenceBrain,
  rows: KeyExample[][],
  weights?: number[],
) {
  return (
    rows.reduce(
      (sum, keys, index) =>
        sum +
        (keys.reduce((value, row) => value + brain.featureLoss(row), 0) /
          keys.length) *
          (weights?.[index] ?? 1),
      0,
    ) / (weights?.reduce((sum, weight) => sum + weight, 0) ?? rows.length)
  );
}

export function trainReadout(
  model: SequenceTrainer,
  training: KeyExample[][],
  validation: KeyExample[][],
  protocol: Warmup,
  random: () => number,
  {
    onValidation,
    sample,
    validationWeights,
    preserveReadout = false,
  }: TrainingOptions = {},
) {
  const flat = training.flat();
  const mean = model.mean.slice();
  const scale = model.scale.slice();
  model.calibrate(flat);
  if (preserveReadout) {
    const inputs = mean.length;
    const units =
      model.options.hidden ||
      (model.parameters.length - model.headStart) / (inputs + 1);
    for (let unit = 0; unit < units; unit++) {
      const offset = model.headStart + unit * (inputs + 1);
      for (let i = 0; i < inputs; i++) {
        const weight = model.parameters[offset + i];
        model.parameters[offset + inputs] +=
          (weight * (model.mean[i] - mean[i])) / scale[i];
        model.parameters[offset + i] = (weight * model.scale[i]) / scale[i];
      }
    }
  }
  let loss = cachedLoss(model, validation, validationWeights);

  if (!Number.isFinite(loss)) {
    throw Error("Non-finite validation loss");
  }

  let checkpoint = model.checkpoint();
  let selectedUpdate = 0;
  const curve = [{ update: 0, loss }];

  for (let update = 1; update <= protocol.updates; update++) {
    model.learnFeatures(
      Array.from(
        { length: protocol.batch },
        sample ?? (() => flat[Math.floor(random() * flat.length)]),
      ),
      protocol.rate,
    );

    if (update % protocol.validateEvery !== 0) {
      continue;
    }

    const current = cachedLoss(model, validation, validationWeights);

    if (!Number.isFinite(current)) {
      throw Error("Non-finite validation loss");
    }

    const row = { update, loss: current };
    curve.push(row);

    if (current < loss) {
      loss = current;
      checkpoint = model.checkpoint();
      selectedUpdate = update;
    }

    onValidation?.(row, checkpoint);

    if (
      protocol.patience !== null &&
      update >= 500 &&
      update - selectedUpdate >= protocol.patience
    ) {
      break;
    }
  }

  return { checkpoint, loss, selectedUpdate, curve };
}
