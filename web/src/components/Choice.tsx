import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";

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
      <Select.Trigger
        className="choice-trigger w-33 inline-flex justify-between items-center gap-3 border border-solid border-[#dfe3e9] rounded-[var(--control-radius)] py-2 px-2.5 bg-white text-[#4d5664] text-[12px] text-left"
        aria-label={label}
      >
        <Select.Value />
        <Select.Icon>
          <ChevronDown aria-hidden="true" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal container={container}>
        <Select.Content
          className="choice-menu min-w-[var(--radix-select-trigger-width)] max-w-70 max-h-[var(--radix-select-content-available-height)] overflow-hidden p-1 border border-solid border-[#dfe3e9] bg-white rounded-[var(--surface-radius)] shadow-[0_5px_20px_#1b243012] z-10"
          position="popper"
          align="end"
          sideOffset={5}
          collisionPadding={12}
        >
          <Select.Viewport>
            {options.map((option) => (
              <Select.Item
                className="choice-item flex items-center justify-between gap-4.5 outline-none cursor-default p-2 rounded-[var(--inset-radius)] text-[12px] text-[#5b6573]"
                key={option.value}
                value={option.value}
                disabled={option.disabled}
              >
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator>
                  <Check aria-hidden="true" />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
