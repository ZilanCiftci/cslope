import { useState, type InputHTMLAttributes } from "react";
import { parseDecimalText } from "../../utils/decimal";

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange"
> & {
  /** Undefined shows an empty field (e.g. "Auto" via placeholder). */
  value: number | undefined;
  /** Called with every complete, finite number the user types. */
  onValueChange: (value: number) => void;
  /** Called when the user empties the field. */
  onClear?: () => void;
};


/**
 * Number input that keeps the user's text while they type.
 *
 * A controlled input that writes `parseFloat(text) || fallback` on every
 * keystroke turns valid 0 into the fallback and cannot hold partial input
 * such as "-" or "0.".  Here only finite numbers are passed on, and the
 * stored value is shown again once the field loses focus.
 *
 * A text field, not type="number": a number field accepts only the decimal
 * separator of the app's locale and drops any other, so "0,5" typed in an
 * English locale became 5. Both "," and "." are read here.
 */
export function DraftNumberInput({
  value,
  onValueChange,
  onClear,
  onBlur,
  ...rest
}: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      value={draft ?? value ?? ""}
      onChange={(e) => {
        setDraft(e.target.value);
        if (e.target.value.trim() === "") {
          onClear?.();
          return;
        }
        const parsed = parseDecimalText(e.target.value);
        if (Number.isFinite(parsed)) onValueChange(parsed);
      }}
      onBlur={(e) => {
        setDraft(null);
        onBlur?.(e);
      }}
    />
  );
}
