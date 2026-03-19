import { useState, type InputHTMLAttributes } from "react";
import { evaluate } from "../../utils/expression";

interface ExpressionNumericInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange"
> {
  value: number;
  expression?: string;
  vars: Record<string, number>;
  onValueChange: (next: number) => void;
  onExpressionChange: (next: string | undefined) => void;
  allowNegative?: boolean;
  min?: number;
  fallbackValue?: number;
}

const NUMBER_LITERAL_RE = /^-?(?:\d+\.?\d*|\.\d+)$/;

function isNumberLiteral(value: string): boolean {
  return NUMBER_LITERAL_RE.test(value.trim());
}

const normalizeDecimalSeparator = (value: string): string =>
  value.replace(/,/g, ".");

export function ExpressionNumericInput({
  value,
  expression,
  vars,
  onValueChange,
  onExpressionChange,
  allowNegative = true,
  min,
  fallbackValue,
  ...inputProps
}: ExpressionNumericInputProps) {
  const [draft, setDraft] = useState(() => expression ?? String(value));
  const [isFocused, setIsFocused] = useState(false);

  const shownValue = isFocused
    ? draft
    : expression && expression.trim().length > 0
      ? expression
      : String(value);

  const normalize = (next: number): number => {
    if (min !== undefined && next < min) {
      return min;
    }
    return next;
  };

  let hasError = false;
  if (!isFocused && expression && expression.trim().length > 0) {
    try {
      evaluate(expression, vars);
    } catch {
      hasError = true;
    }
  }

  const commit = () => {
    const normalizedDraft = normalizeDecimalSeparator(draft);
    const trimmed = normalizedDraft.trim();

    if (trimmed.length === 0) {
      onExpressionChange(undefined);
      return;
    }

    if (isNumberLiteral(trimmed)) {
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) {
        if (!allowNegative && parsed < 0) {
          onValueChange(normalize(fallbackValue ?? min ?? 0));
          onExpressionChange(undefined);
          return;
        }
        onValueChange(normalize(parsed));
        onExpressionChange(undefined);
      }
      return;
    }

    onExpressionChange(trimmed);
    try {
      const resolved = evaluate(trimmed, vars);
      if (!allowNegative && resolved < 0) {
        onValueChange(normalize(fallbackValue ?? min ?? 0));
        return;
      }
      onValueChange(normalize(resolved));
    } catch {
      // Keep previous numeric value until expression becomes valid.
    }
  };

  return (
    <input
      {...inputProps}
      type="text"
      inputMode="decimal"
      value={shownValue}
      onFocus={() => {
        setIsFocused(true);
        setDraft(
          expression && expression.trim().length > 0
            ? expression
            : String(value),
        );
      }}
      onChange={(e) => {
        const nextDraft = normalizeDecimalSeparator(e.target.value);
        setDraft(nextDraft);

        if (isNumberLiteral(nextDraft)) {
          const parsed = Number(nextDraft);
          if (Number.isFinite(parsed)) {
            if (!allowNegative && parsed < 0) return;
            onValueChange(normalize(parsed));
          }
        }
      }}
      onBlur={() => {
        setIsFocused(false);
        commit();
      }}
      style={{
        ...(inputProps.style ?? {}),
        borderColor: hasError
          ? "var(--color-vsc-error)"
          : (inputProps.style as { borderColor?: string } | undefined)
              ?.borderColor,
      }}
    />
  );
}
