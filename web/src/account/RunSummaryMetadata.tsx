import type { RunSummary } from "../../../shared/contracts.ts";

const runDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function RunSummaryMetadata({ run }: { run: RunSummary }) {
  return (
    <>
      <time className="run-weights" dateTime={run.startedAt}>
        <svg aria-hidden="true" viewBox="0 0 20 20">
          <circle cx="10" cy="10" r="6.5" />
          <path d="M10 6v4l2.5 1.5" />
        </svg>
        {runDate.format(new Date(run.startedAt))}
      </time>
      <span className="run-weights">
        <svg aria-hidden="true" viewBox="0 0 20 20">
          <path d="m10 3 7 4-7 4-7-4 7-4Zm-7 7 7 4 7-4m-14 3 7 4 7-4" />
        </svg>
        {run.profile?.name || "Unknown weights"}
      </span>
      <span className="run-weights run-history-status">
        <svg aria-hidden="true" viewBox="0 0 20 20">
          <path d="M4 10h3l2-5 3 10 2-5h2" />
        </svg>
        {run.status}
      </span>
    </>
  );
}
