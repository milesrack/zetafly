import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { useEffect, useState } from "react";
import type { Profile, ProfileSearch } from "./preferences";

export function WeightPicker({
  value,
  onChange,
  profiles,
  search,
  disabled,
  container,
}: {
  value: string;
  onChange: (id: string) => void;
  profiles: Profile[];
  search: ProfileSearch;
  disabled: boolean;
  container: HTMLElement | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{
    query: string;
    profiles: Profile[];
  } | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    const controller = new AbortController();
    let active = true;
    setPending(true);
    setError("");

    const timer = setTimeout(
      () =>
        search(query, controller.signal)
          .then((profiles) => {
            if (active) {
              setResult({ query, profiles });
            }
          })
          .catch(() => {
            if (active) {
              setError("Search unavailable");
            }
          })
          .finally(() => {
            if (active) {
              setPending(false);
            }
          }),
      150,
    );

    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, search]);

  const loading = pending || (!error && result?.query !== query);
  const matches = result?.query === query ? result.profiles : [];

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);

        if (next) {
          setQuery("");
          setResult(null);
          setError("");
        }
      }}
    >
      <Popover.Trigger
        className="choice-trigger"
        role="combobox"
        aria-label="Weight profile"
        aria-expanded={open}
        disabled={disabled}
      >
        <span>
          {profiles.find((profile) => profile.id === value)?.name ?? "Default"}
        </span>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Content
          className="choice-menu weight-menu"
          align="end"
          sideOffset={5}
          collisionPadding={12}
          aria-label="Choose weights"
        >
          <Command shouldFilter={false} loop>
            <Command.Input
              aria-label="Search weights"
              placeholder="Search weights…"
              value={query}
              onValueChange={setQuery}
              maxLength={100}
            />
            <Command.List aria-label="Weight profiles" aria-busy={loading}>
              {loading ? (
                <div className="weight-search-message" role="status">
                  Searching…
                </div>
              ) : error ? (
                <div className="weight-search-message" role="alert">
                  {error}
                </div>
              ) : matches.length ? (
                matches.map((profile) => (
                  <Command.Item
                    className="choice-item"
                    key={profile.id}
                    value={profile.id}
                    onSelect={() => {
                      onChange(profile.id);
                      setOpen(false);
                    }}
                  >
                    <span>{profile.name}</span>
                    {profile.id === value && (
                      <svg viewBox="0 0 16 16" aria-label="Selected">
                        <path d="m3 8 3 3 7-7" />
                      </svg>
                    )}
                  </Command.Item>
                ))
              ) : (
                <div className="weight-search-message" role="status">
                  No weights found
                </div>
              )}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
