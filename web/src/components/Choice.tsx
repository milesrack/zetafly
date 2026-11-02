import * as Select from "@radix-ui/react-select";

export function Choice({
  label,
  value,
  onChange,
  options,
  disabled,
  container,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
  disabled?: boolean;
  container: HTMLElement | null;
}) {
  return (
    <Select.Root value={value} onValueChange={onChange} disabled={disabled}>
      <Select.Trigger className="choice-trigger" aria-label={label}>
        <Select.Value />
        <Select.Icon>
          <svg aria-hidden="true" viewBox="0 0 16 16">
            <path d="m4 6 4 4 4-4" />
          </svg>
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal container={container}>
        <Select.Content
          className="choice-menu"
          position="popper"
          align="end"
          sideOffset={5}
          collisionPadding={12}
        >
          <Select.Viewport>
            {options.map((option) => (
              <Select.Item
                className="choice-item"
                key={option.value}
                value={option.value}
                disabled={option.disabled}
              >
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator>
                  <svg aria-hidden="true" viewBox="0 0 16 16">
                    <path d="m3 8 3 3 7-7" />
                  </svg>
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
