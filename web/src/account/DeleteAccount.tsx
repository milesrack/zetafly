import { useEffect, useRef, useState } from "react";
import { outsideDialog } from "../components/dialog";
import { authClient } from "./auth-client";

export function DeleteAccount({ close }: { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const dismiss = () => {
    if (!busy) {
      close();
    }
  };

  return (
    <dialog
      ref={dialog}
      className="account-dialog"
      aria-label="Delete account"
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          dismiss();
        }
      }}
      onClick={(event) => outsideDialog(event, dismiss)}
    >
      <div className="drawer-heading">
        <h2>Delete account</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Cancel account deletion"
          disabled={busy}
          onClick={dismiss}
        >
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <path d="m5 5 10 10M15 5 5 15" />
          </svg>
        </button>
      </div>
      <form
        className="account-content"
        onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setBusy(true);
          setError("");

          try {
            const result = await authClient.deleteUser({
              password: String(data.get("password")),
            });

            if (result.error) {
              throw Error(result.error.message ?? "Could not delete account");
            }

            close();
          } catch (error) {
            setError((error as Error).message);
            setBusy(false);
          }
        }}
      >
        <p className="email-confirmation" id="delete-account-warning">
          This permanently deletes your account, saved runs, preferences and
          uploaded weights. Any active run will stop. This cannot be undone.
        </p>
        <label>
          Current password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
            disabled={busy}
          />
        </label>
        <label className="delete-confirmation">
          <input type="checkbox" required disabled={busy} />
          <span>
            I understand my account and data will be permanently deleted.
          </span>
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          className="form-submit delete-account-button"
          disabled={busy}
          aria-describedby="delete-account-warning"
        >
          {busy ? "Deleting account…" : "Delete account permanently"}
        </button>
        <button
          type="button"
          className="auth-switch"
          disabled={busy}
          onClick={dismiss}
        >
          Cancel
        </button>
      </form>
    </dialog>
  );
}
