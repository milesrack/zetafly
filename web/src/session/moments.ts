import type { PhysicalFrame } from "../../../shared/contracts.ts";

export type Moment = {
  time: number;
  png?: string | null;
  frame?: PhysicalFrame | null;
};

export function addMoment(moments: Moment[], moment: Moment) {
  let left = 0;
  let right = moments.length;

  while (left < right) {
    const middle = (left + right) >>> 1;

    if (moments[middle].time <= moment.time) {
      left = middle + 1;
    } else {
      right = middle;
    }
  }

  return [...moments.slice(0, left), moment, ...moments.slice(left)];
}

export function momentAt(moments: Moment[], time: number) {
  let left = 0;
  let right = moments.length - 1;

  while (left <= right) {
    const middle = (left + right) >>> 1;

    if (moments[middle].time <= time) {
      left = middle + 1;
    } else {
      right = middle - 1;
    }
  }

  if (right < 0) {
    return;
  }

  let png: string | null | undefined;
  let frame: PhysicalFrame | null | undefined;

  for (
    let i = right;
    i >= 0 && (png === undefined || frame === undefined);
    i--
  ) {
    if (png === undefined) {
      png = moments[i].png;
    }

    if (frame === undefined) {
      frame = moments[i].frame;
    }
  }

  return { time: moments[right].time, png: png ?? null, frame: frame ?? null };
}
