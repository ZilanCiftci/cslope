import { useState } from "react";
import { evaluate } from "../../utils/expression";

interface SpreadsheetExpressionInputProps {
  value: number;
  expression?: string;
  vars: Record<string, number>;
  ariaLabel: string;
  onResolvedValue: (value: number) => void;
  onExpressionChange: (expr: string | undefined) => void;
}

const NUMBER_LITERAL_RE = /^-?(?:\d+\.?\d*|\.\d+)$/;
const TRANSIENT_VALUES = new Set(["", "-", ".", "-."]);

function isNumberLiteral(value: string): boolean {
  return NUMBER_LITERAL_RE.test(value.trim());
}

function normalizeDecimalSeparator(value: string): string {
  return value.replace(/,/g, ".");
}

export function SpreadsheetExpressionInput({
  value,
  expression,
  vars,
  ariaLabel,
  onResolvedValue,
  onExpressionChange,
}: SpreadsheetExpressionInputProps) {
  const [draft, setDraft] = useState(expression ?? String(value));
  const [isFocused, setIsFocused] = useState(false);

  const shownValue = isFocused
    ? draft
    : expression && expression.trim().length > 0
      ? expression
      : String(value);

  let hasError = false;
  if (!isFocused && expression && expression.trim().length > 0) {
    try {
      evaluate(expression, vars);
    } catch {
      hasError = true;
    }
  }

  const commitDraft = () => {
    const normalizedDraft = normalizeDecimalSeparator(draft);
    const trimmed = normalizedDraft.trim();

    if (trimmed.length === 0) {
      onExpressionChange(undefined);
      return;
    }

    if (isNumberLiteral(trimmed)) {
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) {
        onExpressionChange(undefined);
        onResolvedValue(parsed);
      }
      return;
    }

    onExpressionChange(trimmed);
    try {
      const resolved = evaluate(trimmed, vars);
      onResolvedValue(resolved);
    } catch {
      // Keep previous resolved value if expression is invalid.
    }
  };

  return (
    <input
      type="text"
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

        if (TRANSIENT_VALUES.has(nextDraft)) return;

        if (isNumberLiteral(nextDraft)) {
          const parsed = Number(nextDraft);
          if (Number.isFinite(parsed)) {
            onResolvedValue(parsed);
          }
        }
      }}
      onBlur={() => {
        setIsFocused(false);
        commitDraft();
      }}
      className="w-full h-full py-1 px-2 text-[12px] outline-none border-2 border-transparent focus:border-[var(--color-vsc-accent)]"
      style={{
        background: "var(--color-vsc-input-bg)",
        color: "var(--color-vsc-text)",
        borderRadius: 0,
        boxShadow: "none",
        margin: 0,
        borderColor: hasError ? "var(--color-vsc-error)" : undefined,
      }}
      aria-label={ariaLabel}
    />
  );
}
