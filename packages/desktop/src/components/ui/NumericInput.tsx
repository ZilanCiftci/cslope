import { useState, type InputHTMLAttributes } from "react";

interface NumericInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange"
> {
  value: number;
  onValueChange: (next: number) => void;
  allowNegative?: boolean;
  min?: number;
  fallbackValue?: number;
  commitOnChange?: boolean;
}

const TRANSIENT_VALUES = new Set(["", "-", ".", "-."]);

const normalizeDecimalSeparator = (value: string): string =>
  value.replace(/,/g, ".");

export function NumericInput({
  value,
  onValueChange,
  allowNegative = true,
  min,
  fallbackValue,
  commitOnChange = true,
  ...inputProps
}: NumericInputProps) {
  const [draft, setDraft] = useState(() => String(value));
  const [isFocused, setIsFocused] = useState(false);
  const shownValue = isFocused ? draft : String(value);

  const normalize = (next: number): number => {
    if (min !== undefined && next < min) {
      return min;
    }
    return next;
  };

  const isValidDraft = (next: string): boolean => {
    const pattern = allowNegative ? /^-?\d*\.?\d*$/ : /^\d*\.?\d*$/;
    return pattern.test(next);
  };

  const commitDraft = (nextDraft: string) => {
    const normalizedDraft = normalizeDecimalSeparator(nextDraft);
    const parsed = Number(normalizedDraft);
    let resolved: number;

    if (!TRANSIENT_VALUES.has(normalizedDraft) && Number.isFinite(parsed)) {
      resolved = normalize(parsed);
    } else {
      resolved = normalize(fallbackValue ?? min ?? 0);
    }

    onValueChange(resolved);
    setDraft(String(resolved));
  };

  return (
    <input
      {...inputProps}
      type="text"
      inputMode="decimal"
      value={shownValue}
      onFocus={() => {
        setIsFocused(true);
        setDraft(String(value));
      }}
      onChange={(e) => {
        const nextDraft = normalizeDecimalSeparator(e.target.value);
        if (!isValidDraft(nextDraft)) {
          return;
        }

        setDraft(nextDraft);

        if (!commitOnChange || TRANSIENT_VALUES.has(nextDraft)) {
          return;
        }

        const parsed = Number(nextDraft);
        if (Number.isFinite(parsed)) {
          onValueChange(normalize(parsed));
        }
      }}
      onBlur={() => {
        setIsFocused(false);
        commitDraft(draft);
      }}
    />
  );
}
