import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { renewAccess } from "../api";
import { outsideDialog } from "../components/dialog";
import { authClient } from "./auth-client";
import { PasswordInput } from "./PasswordInput";

export function ChangePassword({ close }: { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  function dismiss() {
    if (!busy) {
      close();
    }
  }

  return (
    <dialog
      ref={dialog}
      className="account-dialog w-87.5 max-w-[calc(100vw_-_32px)] p-0 border border-solid border-[#e2e5ea] rounded-[var(--surface-radius)] text-[#18191c] bg-white"
      aria-label="Change password"
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
      <div className="drawer-heading flex justify-between items-center py-4.5 px-6 border-b border-solid border-b-[#eeeff2]">
        <h2>Change password</h2>
        <button
          type="button"
          className="icon-button border-0 size-7.5 bg-transparent grid place-items-center p-1.5"
          aria-label="Close password change"
          disabled={busy}
          onClick={dismiss}
        >
          <X aria-hidden="true" />
        </button>
      </div>
      {changed ? (
        <div className="account-content p-6">
          <p className="email-confirmation" role="status">
            Your password has been changed. Your other sessions have been logged
            out.
          </p>
          <button
            type="button"
            className="form-submit w-full min-h-10.5 border border-solid border-[#1b1d22] bg-[#1b1d22] text-white rounded-[var(--control-radius)] p-2.5 text-[12px]"
            onClick={close}
          >
            Done
          </button>
        </div>
      ) : (
        <form
          className="account-content p-6"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            const newPassword = String(data.get("newPassword"));
            setError("");

            if (newPassword !== data.get("confirmation")) {
              setError("New passwords do not match.");
              return;
            }

            setBusy(true);
            try {
              const result = await authClient.changePassword({
                currentPassword: String(data.get("currentPassword")),
                newPassword,
                revokeOtherSessions: true,
              });

              if (result.error) {
                throw Error(
                  result.error.message ?? "Could not change password",
                );
              }

              form.reset();
              setChanged(true);
              await renewAccess().catch(() => false);
            } catch (error) {
              setError((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Current password
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
              disabled={busy}
            />
          </label>
          <div className="password-field mb-4.5">
            <div className="password-heading flex items-center justify-between gap-3">
              <label htmlFor="change-new-password">New password</label>
            </div>
            <PasswordInput
              creating
              id="change-new-password"
              name="newPassword"
              disabled={busy}
            />
          </div>
          <label>
            Confirm new password
            <input
              name="confirmation"
              type="password"
              autoComplete="new-password"
              required
              maxLength={128}
              disabled={busy}
            />
          </label>
          {error && (
            <p
              className="form-error m-[12px_24px_20px] text-[11px] leading-[1.6] text-[#ab4e47]"
              role="alert"
            >
              {error}
            </p>
          )}
          <button
            type="submit"
            className="form-submit w-full min-h-10.5 border border-solid border-[#1b1d22] bg-[#1b1d22] text-white rounded-[var(--control-radius)] p-2.5 text-[12px]"
            disabled={busy}
          >
            {busy ? "Changing password…" : "Change password"}
          </button>
          <button
            type="button"
            className="auth-switch w-full min-h-10 mt-3 p-2 bg-transparent border-0 rounded-[var(--control-radius)] text-[12px] text-[#586271]"
            disabled={busy}
            onClick={dismiss}
          >
            Cancel
          </button>
        </form>
      )}
    </dialog>
  );
}
