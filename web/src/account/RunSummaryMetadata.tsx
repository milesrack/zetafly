import { Activity, Clock, Layers } from "lucide-react";
import type { RunSummary } from "../../../shared/contracts.ts";

const runDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function RunSummaryMetadata({ run }: { run: RunSummary }) {
  return (
    <>
      <time
        className="run-weights flex items-center gap-1 wrap-anywhere"
        dateTime={run.startedAt}
      >
        <Clock aria-hidden="true" />
        {runDate.format(new Date(run.startedAt))}
      </time>
      <span className="run-weights flex items-center gap-1 wrap-anywhere">
        <Layers aria-hidden="true" />
        {run.profile?.name || "Unknown weights"}
      </span>
      <span className="run-weights flex items-center gap-1 wrap-anywhere run-history-status capitalize">
        <Activity aria-hidden="true" />
        {run.status}
      </span>
    </>
  );
}
