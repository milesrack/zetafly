import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { Check, ChevronDown } from "lucide-react";
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
        className="choice-trigger w-33 inline-flex justify-between items-center gap-3 border border-solid border-[#dfe3e9] rounded-[var(--control-radius)] py-2 px-2.5 bg-white text-[#4d5664] text-[12px] text-left"
        role="combobox"
        aria-label="Weight profile"
        aria-expanded={open}
        disabled={disabled}
      >
        <span>
          {profiles.find((profile) => profile.id === value)?.name ?? "Default"}
        </span>
        <ChevronDown aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Content
          className="choice-menu min-w-[var(--radix-select-trigger-width)] max-w-70 max-h-[var(--radix-select-content-available-height)] overflow-hidden p-1 border border-solid border-[#dfe3e9] bg-white rounded-[var(--surface-radius)] shadow-[0_5px_20px_#1b243012] z-10 weight-menu w-[max(230px,_var(--radix-popover-trigger-width))]"
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
                <div
                  className="weight-search-message py-3 px-2 text-[var(--muted-text)] text-[12px]"
                  role="status"
                >
                  Searching…
                </div>
              ) : error ? (
                <div
                  className="weight-search-message py-3 px-2 text-[var(--muted-text)] text-[12px]"
                  role="alert"
                >
                  {error}
                </div>
              ) : matches.length ? (
                matches.map((profile) => (
                  <Command.Item
                    className="choice-item flex items-center justify-between gap-4.5 outline-none cursor-default p-2 rounded-[var(--inset-radius)] text-[12px] text-[#5b6573]"
                    key={profile.id}
                    value={profile.id}
                    onSelect={() => {
                      onChange(profile.id);
                      setOpen(false);
                    }}
                  >
                    <span>{profile.name}</span>
                    {profile.id === value && <Check aria-label="Selected" />}
                  </Command.Item>
                ))
              ) : (
                <div
                  className="weight-search-message py-3 px-2 text-[var(--muted-text)] text-[12px]"
                  role="status"
                >
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
