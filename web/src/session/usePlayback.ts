import { useEffect, useRef, useState } from "react";
import { type Recording, recordingAt } from "./recordings";

export const PLAYBACK_SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4, 8];

export function usePlayback(
  recordings: Recording[],
  {
    startedAt,
    endedAt,
    running,
    runId,
    clockOffset,
    lastTime = 0,
  }: {
    startedAt?: number;
    endedAt?: number;
    running: boolean;
    runId?: string;
    clockOffset: number;
    lastTime?: number;
  },
) {
  const [clock, setClock] = useState(Date.now);
  const [control, setControl] = useState({
    runId,
    revision: 0,
    position: 0,
    mode: "live" as "live" | "playing" | "paused",
    speed: 1,
    // Freeze this domain on pause; during replay it advances with the playhead.
    rangeEnd: null as number | null,
    scrub: null as { end: number; playing: boolean } | null,
  });

  if (control.runId !== runId) {
    setControl({
      runId,
      revision: 0,
      position: 0,
      mode: "live",
      speed: 1,
      rangeEnd: null,
      scrub: null,
    });
  }

  const last = Math.max(recordings.at(-1)?.end ?? 0, lastTime);
  const endAt = (now: number) =>
    Math.max(
      last,
      startedAt ? ((endedAt ?? now + clockOffset) - startedAt) / 1000 : last,
    );
  const duration = endAt(clock);
  const endRef = useRef(endAt);
  endRef.current = endAt;

  useEffect(() => {
    if (!running && control.mode !== "playing") {
      return;
    }

    let frame: number;
    let previous = performance.now();
    const tick = (now: number) => {
      const delta = (now - previous) / 1000;
      previous = now;
      setClock(Date.now());

      setControl((current) => {
        if (current.mode !== "playing") {
          return current;
        }

        const end = endRef.current(Date.now());
        const position = Math.min(
          end,
          current.position + delta * current.speed,
        );
        const caughtUp = position >= end && (!running || current.speed >= 1);

        return {
          ...current,
          position,
          rangeEnd:
            current.rangeEnd === null
              ? null
              : Math.min(end, current.rangeEnd + delta * current.speed),
          mode: caughtUp ? "live" : "playing",
          speed: caughtUp && running ? 1 : current.speed,
        };
      });

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame);
  }, [running, control.mode]);

  const following = control.mode === "live";
  const position = following ? duration : Math.min(control.position, duration);
  const playing = control.mode === "playing" || (following && running);
  const toEnd = () =>
    setControl((current) => ({
      ...current,
      revision: current.revision + 1,
      position: endRef.current(Date.now()),
      mode: "live",
      speed: running ? 1 : current.speed,
      rangeEnd: null,
      scrub: null,
    }));
  const rangeDuration = control.scrub?.end ?? control.rangeEnd ?? duration;

  return {
    position,
    revision: control.revision,
    duration,
    rangeDuration: following ? duration : rangeDuration,
    following,
    live: following && running,
    playing,
    speed: control.speed,
    selected: recordingAt(recordings, position),
    beginScrub: () =>
      setControl((current) => ({
        ...current,
        revision: current.revision + 1,
        position,
        mode: "paused",
        rangeEnd: following ? duration : rangeDuration,
        scrub: {
          end: following ? duration : rangeDuration,
          playing,
        },
      })),
    endScrub: () =>
      setControl((current) => {
        if (!current.scrub) {
          return current;
        }

        const end = endRef.current(Date.now());
        const atEdge = current.position >= current.scrub.end - 0.05;

        return {
          ...current,
          revision: current.revision + 1,
          position: atEdge ? end : Math.min(current.position, end),
          mode: atEdge ? "live" : current.scrub.playing ? "playing" : "paused",
          speed: atEdge && running ? 1 : current.speed,
          rangeEnd: current.scrub.end,
          scrub: null,
        };
      }),
    seek: (target: number) => {
      if (!Number.isFinite(target)) {
        return;
      }

      setControl((current) => {
        const end = endRef.current(Date.now());
        const rangeEnd = current.scrub?.end ?? current.rangeEnd ?? end;
        const atEdge = !current.scrub && target >= end - 0.05;

        return {
          ...current,
          revision: current.revision + 1,
          position: Math.max(0, Math.min(target, rangeEnd)),
          mode: atEdge ? "live" : "paused",
          rangeEnd: rangeEnd,
          speed: atEdge && running ? 1 : current.speed,
        };
      });
    },
    toEnd,
    skip: (delta: number) => {
      const target = Math.max(0, Math.min(position + delta, duration));

      if (target >= duration) {
        return toEnd();
      }

      setControl((current) => ({
        ...current,
        revision: current.revision + 1,
        position: target,
        rangeEnd: Math.max(current.rangeEnd ?? duration, target),
        mode: playing ? "playing" : "paused",
      }));
    },
    toggle: () =>
      setControl((current) =>
        playing
          ? {
              ...current,
              position,
              mode: "paused",
              rangeEnd: following ? duration : rangeDuration,
            }
          : {
              ...current,
              position: position >= duration - 0.05 && !running ? 0 : position,
              mode: position >= duration - 0.05 && running ? "live" : "playing",
            },
      ),
    setSpeed: (speed: number) =>
      setControl((current) => {
        if (
          !PLAYBACK_SPEEDS.includes(speed) ||
          (following && running && speed > 1)
        ) {
          return current;
        }

        return {
          ...current,
          speed,
          rangeEnd: following ? duration : current.rangeEnd,
          position,
          mode: following && running && speed < 1 ? "playing" : current.mode,
        };
      }),
  };
}
