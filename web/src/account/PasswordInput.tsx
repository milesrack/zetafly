import { useEffect, useState } from "react";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "../../../shared/password-policy.ts";

export function PasswordInput({ creating }: { creating: boolean }) {
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);
  const [focused, setFocused] = useState(false);
  const [assessment, setAssessment] = useState<{
    input: string;
    score: number;
  } | null>(null);
  const tooLong = value.length > MAX_PASSWORD_LENGTH;
  const score = assessment?.input === value ? assessment.score : null;
  const met =
    value.length >= MIN_PASSWORD_LENGTH &&
    !tooLong &&
    score !== null &&
    score >= 2;

  useEffect(() => {
    if (!creating || !value || tooLong) {
      return;
    }

    let active = true;
    const timer = setTimeout(() => {
      import("../../../shared/password-strength.ts")
        .then(({ passwordStrength }) => {
          if (active) {
            setAssessment({ input: value, score: passwordStrength(value) });
          }
        })
        .catch(() => {
          if (active) {
            setAssessment({ input: value, score: -1 });
          }
        });
    }, 150);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [creating, value, tooLong]);

  const feedback = tooLong
    ? `Use ${MAX_PASSWORD_LENGTH} characters or fewer`
    : value.length < MIN_PASSWORD_LENGTH
      ? `At least ${MIN_PASSWORD_LENGTH} characters`
      : score === null
        ? "Checking strength…"
        : score === -1
          ? "Strength checked when you submit"
          : ["Too predictable", "Too predictable", "Fair", "Good", "Strong"][
              score
            ];

  return (
    <>
      <div className="password-input">
        <input
          id="account-password"
          name="password"
          type={visible ? "text" : "password"}
          autoComplete={creating ? "new-password" : "current-password"}
          required
          minLength={creating ? MIN_PASSWORD_LENGTH : 1}
          value={value}
          aria-describedby={
            creating || tooLong ? "password-feedback" : undefined
          }
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => {
            const password = event.currentTarget.value;
            setValue(password);

            event.currentTarget.setCustomValidity(
              password.length > MAX_PASSWORD_LENGTH
                ? `Use ${MAX_PASSWORD_LENGTH} characters or fewer.`
                : "",
            );
          }}
        />
        <button
          type="button"
          className="password-reveal"
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      {(creating || tooLong) && (
        <div
          className="password-feedback"
          id="password-feedback"
          data-visible={focused || Boolean(value)}
          data-met={met}
          data-invalid={tooLong}
          role="status"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            {met ? <path d="m3 8 3 3 7-7" /> : <circle cx="8" cy="8" r="5" />}
          </svg>
          <span>{feedback}</span>
        </div>
      )}
    </>
  );
}
