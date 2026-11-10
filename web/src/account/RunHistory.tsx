import { useEffect, useRef, useState } from "react";
import type { RunSummary } from "../../../shared/contracts.ts";
import { apiFetch } from "../api";
import { outsideDialog } from "../components/dialog";

const pageSize = 10;
const runDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function RunHistory({ close }: { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState({ query: "", page: 1 });
  const [result, setResult] = useState<
    { runs: RunSummary[]; total: number } | "error" | null
  >(null);
  const { query, page } = search;

  useEffect(() => {
    const modal = dialog.current;
    modal?.showModal();

    return () => modal?.close();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({
        q: search.query.trim(),
        page: String(search.page),
        limit: String(pageSize),
      });

      try {
        const response = await apiFetch(`/api/runs?${params}`, { signal });
        const count = response.headers.get("X-Total-Count");
        const total = Number(count);

        if (
          !response.ok ||
          count === null ||
          !Number.isSafeInteger(total) ||
          total < 0
        ) {
          throw new Error("Could not load run history");
        }

        const runs: RunSummary[] = await response.json();
        if (!signal.aborted) {
          setResult({ runs, total });
        }
      } catch {
        if (!signal.aborted) {
          setResult("error");
        }
      }
    }, 200);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search]);

  function load(query: string, page: number) {
    setResult(null);
    setSearch({ query, page });
  }

  const pages =
    result && result !== "error" ? Math.ceil(result.total / pageSize) : 0;

  return (
    <dialog
      ref={dialog}
      className="account-dialog run-history"
      aria-labelledby="run-history-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          close();
        }
      }}
      onClick={(event) => outsideDialog(event, close)}
    >
      <div className="drawer-heading">
        <h2 id="run-history-title">Run history</h2>
        <button
          type="button"
          className="icon-button"
          onClick={close}
          aria-label="Close history"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <path d="m5 5 10 10M15 5 5 15" />
          </svg>
        </button>
      </div>
      <div className="account-content">
        <label>
          Search runs
          <input
            type="search"
            maxLength={100}
            placeholder="Run ID, profile, or status"
            value={query}
            onChange={(event) => load(event.target.value, 1)}
          />
        </label>
        {result === "error" ? (
          <>
            <p className="form-error" role="alert">
              Could not load runs.
            </p>
            <button type="button" onClick={() => load(query, page)}>
              Retry
            </button>
          </>
        ) : !result ? (
          <p role="status">Loading runs…</p>
        ) : result.runs.length === 0 ? (
          <p role="status">
            {query.trim() ? "No runs match your search." : "No previous runs."}
          </p>
        ) : (
          <ul className="run-history-list">
            {result.runs.map((run) => (
              <li key={run.id}>
                <strong>{run.profile?.name || "Unknown profile"}</strong>
                <time dateTime={run.startedAt}>
                  {runDate.format(new Date(run.startedAt))}
                </time>
                <span>{run.status}</span>
                <span>Score: {run.accepted}</span>
              </li>
            ))}
          </ul>
        )}
        {(page > 1 || pages > 1) && (
          <nav
            className="run-history-pages"
            aria-label="Run history pagination"
          >
            <button
              type="button"
              disabled={page === 1}
              onClick={() => load(query, page - 1)}
            >
              Previous
            </button>
            <span role="status">
              {pages ? `Page ${page} of ${pages}` : `Page ${page}`}
            </span>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => load(query, page + 1)}
            >
              Next
            </button>
          </nav>
        )}
      </div>
    </dialog>
  );
}
