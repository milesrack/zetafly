import { useEffect, useRef, useState } from "react";
import { Choice } from "../components/Choice";
import { PLAYBACK_SPEEDS, type usePlayback } from "./usePlayback";

export function formatTime(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));

  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

export function BrainTimeline({
  playback,
}: {
  playback: ReturnType<typeof usePlayback>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const [touch, setTouch] = useState(false);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setTouch(false);
      }
    };

    document.addEventListener("pointerdown", outside);

    return () => document.removeEventListener("pointerdown", outside);
  }, []);

  const {
    position,
    rangeDuration,
    duration,
    live,
    playing,
    speed,
    seek,
    toggle,
    setSpeed,
    skip,
    toEnd,
    beginScrub,
    endScrub,
  } = playback;
  const seekFromPointer = (event: React.PointerEvent<HTMLInputElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();

    if (bounds.width <= 0) {
      return;
    }

    const fraction = Math.max(
      0,
      Math.min(1, (event.clientX - bounds.left) / bounds.width),
    );

    seek(fraction * rangeDuration);
  };
  const finishScrub = () => {
    if (dragging.current === null) {
      return;
    }

    dragging.current = null;
    endScrub();
  };

  return (
    <div
      ref={root}
      className="brain-timeline"
      data-revealed={touch || undefined}
      onPointerDown={(event) => {
        if (event.pointerType === "touch") {
          setTouch(true);
        }
      }}
    >
      <div className="timeline-track">
        <div
          className="timeline-fill"
          style={{
            width: `${rangeDuration ? (position / rangeDuration) * 100 : 0}%`,
          }}
        />
        <input
          className="timeline-seek"
          type="range"
          onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0) {
              return;
            }

            // Native range dragging under pointer capture differs in WebKit.
            // Own pointer seeking while retaining the range for accessibility.
            event.preventDefault();
            event.currentTarget.focus();
            dragging.current = event.pointerId;
            event.currentTarget.setPointerCapture(event.pointerId);
            beginScrub();
            seekFromPointer(event);
          }}
          onPointerMove={(event) => {
            if (dragging.current === event.pointerId) {
              seekFromPointer(event);
            }
          }}
          onPointerUp={(event) => {
            if (dragging.current !== event.pointerId) {
              return;
            }

            seekFromPointer(event);
            finishScrub();
          }}
          onLostPointerCapture={finishScrub}
          onPointerCancel={finishScrub}
          onKeyDown={(event) => {
            if (event.key === "End") {
              event.preventDefault();
              toEnd();
            } else if (event.key === "Home") {
              event.preventDefault();
              seek(0);
            } else if (event.code === "Space") {
              event.preventDefault();
              toggle();
            } else if (
              event.key === "ArrowLeft" ||
              event.key === "ArrowRight" ||
              event.key === "ArrowUp" ||
              event.key === "ArrowDown" ||
              event.key === "PageUp" ||
              event.key === "PageDown"
            ) {
              event.preventDefault();

              skip(
                (["ArrowLeft", "ArrowDown", "PageDown"].includes(event.key)
                  ? -1
                  : 1) *
                  (event.key.startsWith("Page")
                    ? 10
                    : event.shiftKey
                      ? 0.1
                      : 5),
              );
            }
          }}
          aria-label="Run playback time"
          aria-valuetext={`${formatTime(position)}${live ? ", live" : ` of ${formatTime(rangeDuration)}`}`}
          min={0}
          max={rangeDuration || 0.001}
          step="any"
          value={position}
          onChange={(event) => {
            const value = Number(event.target.value);
            seek(value);
          }}
        />
      </div>
      <div className="timeline-controls">
        <div className="timeline-times">
          <span>{formatTime(position)}</span>
          <span className={live ? "timeline-live" : undefined}>
            {live ? "LIVE" : formatTime(rangeDuration)}
          </span>
        </div>
        <div className="timeline-transport">
          <button
            type="button"
            className="timeline-skip timeline-back"
            disabled={position <= 0}
            aria-label="Back 5 seconds"
            title="Back 5 seconds (←)"
            onClick={() => skip(-5)}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M5 4a7 7 0 1 1-2 9M5 1v4H1" />
              <text x="10" y="13" textAnchor="middle">
                5
              </text>
            </svg>
          </button>
          <button
            type="button"
            className="timeline-play"
            aria-label={playing ? "Pause playback" : "Play recording"}
            title={playing ? "Pause playback" : "Play recording"}
            onClick={toggle}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              {playing ? (
                <path d="M6 4h3v12H6zm5 0h3v12h-3z" />
              ) : (
                <path d="m6 3 11 7-11 7z" />
              )}
            </svg>
          </button>
          <button
            type="button"
            className="timeline-skip timeline-forward"
            disabled={live || position >= duration - 0.05}
            aria-label="Forward 5 seconds"
            title="Forward 5 seconds (→)"
            onClick={() => skip(5)}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path
                transform="translate(20 0) scale(-1 1)"
                d="M5 4a7 7 0 1 1-2 9M5 1v4H1"
              />
              <text x="10" y="13" textAnchor="middle">
                5
              </text>
            </svg>
          </button>
          <Choice
            label="Playback speed"
            value={String(speed)}
            onChange={(value) => setSpeed(Number(value))}
            options={PLAYBACK_SPEEDS.map((value) => ({
              value: String(value),
              label: `${value}×`,
              disabled: live && value > 1,
            }))}
            container={root.current}
          />
        </div>
      </div>
    </div>
  );
}
