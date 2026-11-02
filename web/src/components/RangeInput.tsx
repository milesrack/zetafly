import { useEffect, useState } from "react";

export function RangeInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  function commit() {
    const number = Number(draft);

    if (/^-?\d+$/.test(draft) && Number.isSafeInteger(number)) {
      onChange(number);
    } else {
      setDraft(String(value));
    }
  }

  return (
    <input
      aria-label={label}
      type="text"
      inputMode="numeric"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}
