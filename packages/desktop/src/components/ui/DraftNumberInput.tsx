import { useState, type InputHTMLAttributes } from "react";

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange"
> & {
  value: number;
  /** Called with every complete, finite number the user types. */
  onValueChange: (value: number) => void;
};

/**
 * Number input that keeps the user's text while they type.
 *
 * A controlled input that writes `parseFloat(text) || fallback` on every
 * keystroke turns valid 0 into the fallback and cannot hold partial input
 * such as "-" or "0.".  Here only finite numbers are passed on, and the
 * stored value is shown again once the field loses focus.
 */
export function DraftNumberInput({
  value,
  onValueChange,
  onBlur,
  ...rest
}: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      {...rest}
      type="number"
      value={draft ?? value}
      onChange={(e) => {
        setDraft(e.target.value);
        if (e.target.value.trim() === "") return;
        const parsed = Number(e.target.value);
        if (Number.isFinite(parsed)) onValueChange(parsed);
      }}
      onBlur={(e) => {
        setDraft(null);
        onBlur?.(e);
      }}
    />
  );
}
