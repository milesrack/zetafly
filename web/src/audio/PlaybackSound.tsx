import { useEffect, useEffectEvent, useRef } from "react";
import type { PhysicalFrame } from "../../../shared/contracts.ts";
import type { Moment } from "../session/moments";
import type { usePlayback } from "../session/usePlayback";
import type { Sound } from "./useSound";

export function usePlaybackSound(
  moments: Moment[],
  playback: ReturnType<typeof usePlayback>,
  runId: string | undefined,
  frame: PhysicalFrame | null,
  sound: Sound,
) {
  const snapshot = () => ({
    position: playback.position,
    revision: playback.revision,
    runId,
    playing: playback.playing,
    visible: !document.hidden,
    following: playback.following,
  });
  const previous = useRef<ReturnType<typeof snapshot> | null>(null);
  const contact = useRef<number | Moment["frame"]>(undefined);
  const visibilityChanged = useEffectEvent(() => {
    previous.current = snapshot();
    contact.current =
      frame?.phase === "contact" ? (frame.contactId ?? frame) : undefined;
  });

  useEffect(() => {
    const before = previous.current;
    const visible = !document.hidden;
    const continuous =
      before &&
      before.runId === runId &&
      before.revision === playback.revision &&
      before.playing &&
      playback.playing &&
      before.visible &&
      visible &&
      playback.position >= before.position;

    if (before?.runId !== runId) {
      contact.current = undefined;
    }

    sound.playback(playback.playing);

    if (playback.following) {
      if (frame?.phase === "contact") {
        const id = frame.contactId ?? frame;

        if (continuous && before.following && contact.current !== id) {
          sound.keypress();
        }

        contact.current = id;
      }
    } else if (
      continuous &&
      !before.following &&
      playback.position - before.position < 0.3 * Math.max(1, playback.speed)
    ) {
      let left = 0;
      let right = moments.length;

      while (left < right) {
        const middle = (left + right) >>> 1;

        if (moments[middle].time <= before.position) {
          left = middle + 1;
        } else {
          right = middle;
        }
      }

      for (
        let index = left;
        index < moments.length && moments[index].time <= playback.position;
        index++
      ) {
        const moment = moments[index];

        if (
          moment.time <= before.position ||
          moment.time > playback.position ||
          moment.frame?.phase !== "contact"
        ) {
          continue;
        }

        const id = moment.frame.contactId ?? moment.frame;

        if (contact.current !== id) {
          contact.current = id;
          sound.keypress();
        }
      }
    }

    if (!continuous && !playback.following) {
      contact.current = undefined;
    }

    previous.current = snapshot();
  });

  useEffect(() => {
    document.addEventListener("visibilitychange", visibilityChanged);

    return () => {
      document.removeEventListener("visibilitychange", visibilityChanged);
      sound.playback(false);
    };
  }, [sound.playback]);
}

export function SoundButton({ sound }: { sound: Sound }) {
  const label = sound.blocked
    ? "Enable sound"
    : sound.enabled
      ? "Mute sound"
      : "Unmute sound";

  return (
    <button
      type="button"
      className="sound-button"
      aria-label={label}
      title={label}
      aria-pressed={!sound.blocked && sound.enabled}
      onClick={sound.blocked ? sound.activate : sound.toggle}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M3 8h3l4-4v12l-4-4H3Z" />
        {sound.enabled && !sound.blocked ? (
          <path d="M13 7a5 5 0 0 1 0 6m2-9a9 9 0 0 1 0 12" />
        ) : (
          <path d="m13 8 4 4m0-4-4 4" />
        )}
      </svg>
    </button>
  );
}
