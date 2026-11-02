import type { NeuralActivity } from "../../../shared/contracts.ts";

export function activityAt(neural: NeuralActivity | undefined, time: number) {
  const activity = new Map<number, number>();

  if (!neural || time < 0) {
    return activity;
  }

  const duration = neural.rateSteps ?? neural.durationMs;
  const tail = neural.rateSteps === undefined ? 60 : 2;

  if (time >= duration + tail) {
    return activity;
  }

  for (const [id, at, value] of neural.rates ?? []) {
    const age = time - at;

    if (age >= 0 && age < tail) {
      activity.set(
        id,
        Math.max(
          activity.get(id) ?? 0,
          Math.abs(value) * Math.exp(-age / (tail / 3)),
        ),
      );
    }
  }

  for (const [id, at] of neural.spikes) {
    const age = time - at;

    if (age >= 0 && age < tail) {
      activity.set(id, (activity.get(id) ?? 0) + Math.exp(-age / 18));
    }
  }

  return activity;
}
