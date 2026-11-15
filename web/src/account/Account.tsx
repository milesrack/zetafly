import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { outsideDialog } from "../components/dialog";
import { authClient, type User } from "./auth-client";
import { PasswordInput } from "./PasswordInput";

type Mode = "login" | "signup" | "verify" | "forgot" | "sent" | "reset";

const query = new URLSearchParams(location.search);
const resetRequested = query.get("resetPassword") === "1";
const resetToken = resetRequested ? query.get("token") : null;
const resetLinkError =
  resetRequested && !resetToken
    ? "This reset link is invalid or expired. Request a new one."
    : "";
export const hasPasswordReset = resetRequested;

export function Account({
  open,
  close,
  user,
}: {
  open: boolean;
  close: () => void;
  user: User | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);
  const [mode, setMode] = useState<Mode>(
    resetToken ? "reset" : resetRequested ? "forgot" : "login",
  );
  const [email, setEmail] = useState("");
  const [error, setError] = useState(resetLinkError);
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);
  const [resendUntil, setResendUntil] = useState(0);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (open) {
      setResent(false);

      if (user && !user.emailVerified) {
        setEmail(user.email);
        setMode("verify");
      }

      dialog.current?.showModal();
    } else {
      dialog.current?.close();
      generation.current++;
      setMode("login");
      setError("");
      setBusy(false);
      setResent(false);
    }
  }, [open, user]);

  useEffect(() => {
    if (
      open &&
      user?.emailVerified &&
      ["login", "signup", "verify"].includes(mode)
    ) {
      close();
    }
  }, [open, user?.emailVerified, mode, close]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Switching forms must move focus to the new form.
  useEffect(() => {
    if (open) {
      dialog.current
        ?.querySelector<HTMLElement>(
          "input, .account-content button:not(:disabled)",
        )
        ?.focus();
    }
  }, [open, mode]);

  useEffect(() => {
    if (!resendUntil) {
      return;
    }

    const tick = () => {
      const seconds = Math.max(0, Math.ceil((resendUntil - Date.now()) / 1000));
      setRemaining(seconds);

      if (!seconds) {
        setResendUntil(0);
        setResent(false);
      }
    };

    tick();
    const timer = setInterval(tick, 1000);

    return () => clearInterval(timer);
  }, [resendUntil]);

  function cooldown() {
    setRemaining(30);
    setResendUntil(Date.now() + 30000);
  }

  const title = {
    login: "Log in",
    signup: "Create account",
    verify: "Verify your email",
    forgot: "Reset password",
    sent: "Check your email",
    reset: "New password",
  }[mode];

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const request = ++generation.current;
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const address = String(data.get("email") ?? email).trim();

    try {
      if (mode === "forgot") {
        const result = await authClient.requestPasswordReset({
          email: address,
          redirectTo: `${location.origin}/?resetPassword=1`,
        });

        if (request !== generation.current) {
          return;
        }

        if (result.error) {
          throw Error(result.error.message);
        }

        setEmail(address);
        setMode("sent");

        return;
      }

      if (mode === "reset") {
        const result = await authClient.resetPassword({
          newPassword: String(data.get("password")),
          token: resetToken ?? "",
        });

        if (result.error) {
          throw Error(result.error.message);
        }

        await authClient.signOut();
        history.replaceState(null, "", location.pathname);

        if (request === generation.current) {
          setMode("login");
        }

        return;
      }

      const fields = { email: address, password: String(data.get("password")) };
      const result =
        mode === "signup"
          ? await authClient.signUp.email({
              ...fields,
              name: String(data.get("name")),
              callbackURL: `${location.origin}/`,
            })
          : await authClient.signIn.email(fields);

      if (request !== generation.current) {
        return;
      }

      if (result.error) {
        if (result.error.code === "EMAIL_NOT_VERIFIED") {
          setEmail(address);
          cooldown();
          setMode("verify");

          return;
        }

        throw Error(result.error.message ?? "Unable to log in");
      }

      if (mode === "signup") {
        setEmail(address);
        cooldown();
        setMode("verify");
      } else {
        close();
      }
    } catch (error) {
      if (request === generation.current) {
        setError((error as Error).message);
      }
    } finally {
      if (request === generation.current) {
        setBusy(false);
      }
    }
  }

  async function resend() {
    const request = ++generation.current;
    setBusy(true);
    setError("");
    setResent(false);

    try {
      const result = await authClient.sendVerificationEmail({
        email,
        callbackURL: `${location.origin}/`,
      });

      if (request !== generation.current) {
        return;
      }

      if (result.error) {
        throw Error(result.error.message);
      }

      setResent(true);
      cooldown();
    } catch (error) {
      if (request === generation.current) {
        setError((error as Error).message);
      }
    } finally {
      if (request === generation.current) {
        setBusy(false);
      }
    }
  }

  const failure = error && (
    <p
      id="account-error"
      className="form-error m-[12px_24px_20px] text-[11px] leading-[1.6] text-[#ab4e47]"
      role="alert"
    >
      {error}
    </p>
  );

  return (
    <dialog
      ref={dialog}
      className="account-dialog w-87.5 max-w-[calc(100vw_-_32px)] p-0 border border-solid border-[#e2e5ea] rounded-[var(--surface-radius)] text-[#18191c] bg-white"
      onCancel={close}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          close();
        }
      }}
      onClick={(event) => outsideDialog(event, close)}
      aria-label={title}
    >
      <div className="drawer-heading flex justify-between items-center py-4.5 px-6 border-b border-solid border-b-[#eeeff2]">
        <h2>{title}</h2>
        <button
          type="button"
          className="icon-button border-0 size-7.5 bg-transparent grid place-items-center p-1.5"
          onClick={close}
          aria-label="Close account"
        >
          <X aria-hidden="true" />
        </button>
      </div>
      {mode === "verify" || mode === "sent" ? (
        <div className="account-content p-6">
          <span className="sr-only" role="status">
            {resent ? "Verification email sent." : ""}
          </span>
          <p className="email-confirmation">
            {mode === "verify" ? (
              <>
                Open the verification link sent to <strong>{email}</strong> to
                finish creating your account.
              </>
            ) : (
              <>
                If an account uses <strong>{email}</strong>, you’ll receive a
                password reset link.
              </>
            )}
          </p>
          {failure}
          {mode === "verify" && (
            <button
              type="button"
              className="form-submit w-full min-h-10.5 border border-solid border-[#1b1d22] bg-[#1b1d22] text-white rounded-[var(--control-radius)] p-2.5 text-[12px]"
              disabled={busy || remaining > 0}
              aria-describedby={error ? "account-error" : undefined}
              onClick={resend}
            >
              {busy
                ? "Sending…"
                : remaining > 0
                  ? `Resend in 00:${String(remaining).padStart(2, "0")}`
                  : "Resend email"}
            </button>
          )}
          <button
            type="button"
            className="auth-switch w-full min-h-10 mt-3 p-2 bg-transparent border-0 rounded-[var(--control-radius)] text-[12px] text-[#586271]"
            disabled={busy}
            onClick={() => {
              setMode("login");
              setError("");
              setResent(false);
            }}
          >
            Back to log in
          </button>
        </div>
      ) : (
        <form
          key={mode}
          className="account-content p-6"
          onInput={() => {
            if (error) {
              setError("");
            }
          }}
          onSubmit={submit}
        >
          {mode === "signup" && (
            <label>
              Name
              <input name="name" autoComplete="name" required maxLength={80} />
            </label>
          )}
          {mode !== "reset" && (
            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                maxLength={254}
              />
            </label>
          )}
          {mode !== "forgot" && (
            <div className="password-field mb-4.5">
              <div className="password-heading flex items-center justify-between gap-3">
                <label htmlFor="account-password">Password</label>
                {mode === "login" && (
                  <button
                    type="button"
                    className="auth-recovery min-h-8 p-[5px_0_5px_8px] border-0 bg-transparent text-[11px] text-[#586271]"
                    disabled={busy}
                    onClick={() => {
                      setMode("forgot");
                      setError("");
                    }}
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <PasswordInput key={String(open)} creating={mode !== "login"} />
            </div>
          )}
          {failure}
          <button
            type="submit"
            className="form-submit w-full min-h-10.5 border border-solid border-[#1b1d22] bg-[#1b1d22] text-white rounded-[var(--control-radius)] p-2.5 text-[12px]"
            disabled={busy}
            aria-describedby={error ? "account-error" : undefined}
          >
            {busy
              ? "Please wait…"
              : {
                  login: "Log in",
                  signup: "Create account",
                  forgot: "Send reset link",
                  reset: "Save password",
                }[mode]}
          </button>
          {mode === "login" || mode === "signup" ? (
            <p className="auth-footer">
              {mode === "login"
                ? "Don’t have an account?"
                : "Already have an account?"}{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setMode(mode === "login" ? "signup" : "login");
                  setError("");
                }}
              >
                {mode === "login" ? "Sign up" : "Log in"}
              </button>
            </p>
          ) : (
            <button
              type="button"
              disabled={busy}
              className="auth-switch w-full min-h-10 mt-3 p-2 bg-transparent border-0 rounded-[var(--control-radius)] text-[12px] text-[#586271]"
              onClick={() => {
                setMode("login");
                setError("");
              }}
            >
              Back to log in
            </button>
          )}
        </form>
      )}
    </dialog>
  );
}
