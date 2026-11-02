import { useEffect, useRef, useState } from "react";
import type { NeuralActivity as Neural } from "../../../shared/contracts.ts";

export function NeuralActivity({
  neural,
  time,
}: {
  neural?: Neural;
  time?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(380);

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );

    if (container.current) {
      observer.observe(container.current);
    }

    return () => observer.disconnect();
  }, []);

  const sensory = new Set(neural?.inputs ?? []);
  const rateModel = neural?.rateSteps !== undefined;
  const rows = new Map<number, [number, number][]>();

  for (const [id, time, value] of rateModel
    ? (neural?.rates ?? [])
    : (neural?.spikes ?? [])) {
    if (!rows.has(id)) {
      rows.set(id, []);
    }

    rows.get(id)!.push([time, value ?? 1]);
  }

  const ids = [...rows.keys()].sort(
    (a, b) => Number(sensory.has(b)) - Number(sensory.has(a)) || a - b,
  );
  const duration = neural?.rateSteps ?? neural?.durationMs ?? 250;
  const left = 12;
  const right = width - 12;
  const bottom = 168;
  const cell = (right - left) / (duration + 1);
  const x = (time: number) =>
    rateModel
      ? left + (time + 0.5) * cell
      : left + (time / duration) * (right - left);
  const rowHeight = 148 / Math.max(1, ids.length);

  return (
    <section className="neural-panel">
      <div className="raster-heading">
        <h2>Neural activity</h2>
        {neural && <span>{ids.length.toLocaleString()} neurons</span>}
      </div>
      <div ref={container} className="raster">
        {neural ? (
          <svg
            width={width}
            height={198}
            role="img"
            aria-label={`${rateModel ? "Sampled rate magnitudes by model step" : "Recorded neuron spikes by simulation time"} for one inference; not a rolling session timeline`}
          >
            <title>
              {rateModel
                ? "Each cell shows the magnitude of one sampled neuron’s rate at a model step."
                : "Each mark is a recorded spike. Each row is one active neuron."}
            </title>
            {[0, duration / 2, duration].map((t) => (
              <g key={t}>
                <line x1={x(t)} x2={x(t)} y1={8} y2={bottom} stroke="#eef0f3" />
                <text
                  x={x(t)}
                  y={bottom + 16}
                  textAnchor={
                    t === 0 ? "start" : t === duration ? "end" : "middle"
                  }
                >
                  {Number(t.toFixed(1))}
                </text>
              </g>
            ))}
            {ids.map((id, row) => (
              <g key={id}>
                <title>{`Neuron ${id}${sensory.has(id) ? " (sensory input)" : ""}`}</title>
                {rows.get(id)!.map(([time, value]) => (
                  <rect
                    key={time}
                    x={rateModel ? x(time) - cell / 2 : x(time)}
                    y={8 + row * rowHeight + (rateModel ? 0 : rowHeight / 2)}
                    width={rateModel ? Math.max(1, cell - 1) : 1.5}
                    height={
                      rateModel
                        ? Math.max(0.6, rowHeight - 0.5)
                        : Math.min(3, Math.max(0.6, rowHeight * 0.7))
                    }
                    fill={sensory.has(id) ? "#3b70db" : "#e56936"}
                    opacity={
                      rateModel
                        ? Math.min(1, Math.max(0.08, Math.abs(value)))
                        : 0.85
                    }
                  />
                ))}
              </g>
            ))}
            {time !== undefined && (
              <line
                className="activity-playhead"
                x1={x(Math.max(0, Math.min(time, duration)))}
                x2={x(Math.max(0, Math.min(time, duration)))}
                y1={8}
                y2={bottom}
                stroke="#333d4c"
                strokeWidth={1}
              />
            )}
            <text x={left} y={197}>
              {rateModel ? "Model step" : "Time (ms)"}
            </text>
          </svg>
        ) : (
          <div className="activity-empty">No recording yet</div>
        )}
      </div>
      {neural && (
        <div className="raster-legend">
          <span>
            <i className="sensory" />
            Input
          </span>
          <span>
            <i />
            Downstream
          </span>
        </div>
      )}
    </section>
  );
}
