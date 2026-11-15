import { Check, Copy, History, LogOut, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { authClient, type User } from "./auth-client";
import { RunHistory } from "./RunHistory";

export function AccountMenu({
  user,
  verify,
  settings,
}: {
  user: User;
  verify: () => void;
  settings: () => void;
}) {
  const popover = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = setTimeout(() => setCopied(0), 2000);

    return () => clearTimeout(timer);
  }, [copied]);

  async function logout() {
    setBusy(true);
    setError("");

    try {
      const result = await authClient.signOut();

      if (result.error) {
        throw Error(result.error.message);
      }

      popover.current?.hidePopover();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="account-button grid place-items-center border border-solid border-[#dfe3e9] rounded-full size-7 p-0 bg-[#f3f5f7] text-[11px] text-[#6e7887]"
        aria-label="Account"
        popoverTarget="account-menu"
      >
        {user.name.slice(0, 1).toUpperCase()}
      </button>
      <div
        ref={popover}
        id="account-menu"
        popover="auto"
        className="account-menu fixed inset-[52px_24px_auto_auto] m-0 w-65 max-w-[calc(100vw_-_32px)] p-1.5 border border-solid border-[#e3e6eb] rounded-[var(--surface-radius)] bg-white text-[#18191c] shadow-[0_6px_24px_#18202c0d]"
        onToggle={() => {
          setCopied(0);
          setError("");
        }}
      >
        <div className="account-identity grid gap-1 p-2.5">
          <strong className="account-name text-[13px] font-[550] wrap-anywhere">
            {user.name}
          </strong>
          <div className="account-email-row flex items-center gap-1.5">
            <span className="account-email">{user.email}</span>
            <button
              type="button"
              className="copy-email"
              aria-label={copied ? "Email copied" : "Copy email"}
              title={copied ? "Copied" : "Copy email"}
              onClick={async () => {
                setError("");

                try {
                  await navigator.clipboard.writeText(user.email);
                  setCopied(Date.now());
                } catch {
                  setError("Could not copy email. Select it to copy manually.");
                }
              }}
            >
              {copied ? (
                <Check aria-hidden="true" />
              ) : (
                <Copy aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
        {!user.emailVerified && (
          <button
            type="button"
            onClick={() => {
              popover.current?.hidePopover();
              verify();
            }}
          >
            Verify email
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            popover.current?.hidePopover();
            settings();
          }}
        >
          <Settings aria-hidden="true" />
          Settings
        </button>
        {user.emailVerified && (
          <button
            type="button"
            onClick={() => {
              popover.current?.hidePopover();
              setHistoryOpen(true);
            }}
          >
            <History aria-hidden="true" />
            History
          </button>
        )}
        {error && (
          <p
            className="form-error m-[12px_24px_20px] text-[11px] leading-[1.6] text-[#ab4e47]"
            role="alert"
          >
            {error}
          </p>
        )}
        <button type="button" disabled={busy} onClick={logout}>
          <LogOut aria-hidden="true" />
          {busy ? "Logging out…" : "Log out"}
        </button>
      </div>
      {user.emailVerified && historyOpen && (
        <RunHistory close={() => setHistoryOpen(false)} />
      )}
    </>
  );
}
