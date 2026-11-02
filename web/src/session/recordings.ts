import type {
  ActivityTiming,
  NeuralActivity,
} from "../../../shared/contracts.ts";

export type Recording = {
  id: string;
  start: number;
  end: number;
  neural: NeuralActivity;
  checkpoints: [number, number][];
};

export function addRecording(
  history: Recording[],
  neural: NeuralActivity,
  timing: ActivityTiming,
  origin: number,
): Recording[] {
  const start = Math.max(0, (timing.startedAt - origin) / 1000);
  const end = Math.max(start + 0.001, (timing.recordedAt - origin) / 1000);
  const last = history.at(-1);
  const checkpoint: [number, number] = [end, timing.through];

  if (last?.id === timing.observationId) {
    return [
      ...history.slice(0, -1),
      { ...last, end, neural, checkpoints: [...last.checkpoints, checkpoint] },
    ];
  }

  return [
    ...history,
    {
      id: timing.observationId,
      start,
      end,
      neural,
      checkpoints: [[start, 0], checkpoint],
    },
  ];
}

export function recordingAt(history: Recording[], position: number) {
  let left = 0;
  let right = history.length - 1;

  while (left <= right) {
    const middle = (left + right) >>> 1;

    if (history[middle].start <= position) {
      left = middle + 1;
    } else {
      right = middle - 1;
    }
  }

  const recording = history[right];

  if (!recording) {
    return;
  }

  const { checkpoints, neural } = recording;
  const last = checkpoints.at(-1)!;

  if (position >= recording.end) {
    return {
      neural,
      time:
        last[1] +
        ((position - recording.end) *
          (neural.rateSteps === undefined ? 60 : 2)) /
          0.3,
    };
  }

  for (let i = 1; i < checkpoints.length; i++) {
    const [at, through] = checkpoints[i];
    const [previous, from] = checkpoints[i - 1];

    if (position <= at) {
      return {
        neural,
        time:
          from +
          ((through - from) * (position - previous)) /
            Math.max(0.001, at - previous),
      };
    }
  }
}
