/**
 * Properties of the selected colour bar(s): the FOS range of the scale
 * (automatic, fixed bounds, or the span of the surface filter) and its
 * colour scheme (a preset, or custom end colours with an optional middle
 * colour). The scale chosen here also colours the surfaces of the plot.
 */

import { useCallback, useId } from "react";
import { DraftNumberInput } from "../../components/ui/DraftNumberInput";
import {
  CUSTOM_SCHEME_DEFAULTS,
  FOS_SCHEME_PRESETS,
  fosSchemeColorAt,
  fosSchemeGradient,
  validFosScaleBounds,
  type FosSchemeId,
} from "../../utils/fos-color";
import { colorBarRange, colorBarScheme } from "../annotations/colorScale";
import type { AnalysisResult, Annotation, ColorScaleMode } from "../../store/types";

const RANGE_OPTIONS: Array<{ value: ColorScaleMode; label: string }> = [
  { value: "auto", label: "Automatic" },
  { value: "fixed", label: "Fixed" },
  { value: "filter", label: "Follow the surface filter" },
];

const MIXED = "__mixed__";
const LABEL_CLASS = "text-[10px] block mb-0.5";
const MUTED = { color: "var(--color-vsc-text-muted)" } as const;

function commonValue<T>(values: T[]): T | undefined {
  if (values.length === 0) return undefined;
  const first = values[0];
  return values.every((v) => v === first) ? first : undefined;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** A colour field: the picker with its hex value beside it. */
function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (hex: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex-1">
      <label htmlFor={id} className={LABEL_CLASS} style={MUTED}>
        {label}
      </label>
      <div className="flex items-center gap-1.5">
        <input
          id={id}
          type="color"
          value={value ?? "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="w-6 h-6 rounded border cursor-pointer bg-transparent p-0 shrink-0"
          style={{ borderColor: "var(--color-vsc-border)" }}
          aria-label={`${label} color`}
        />
        <span className="text-[10px] tabular-nums" style={MUTED}>
          {value ?? "Mixed"}
        </span>
      </div>
    </div>
  );
}

export function ColorBarProperties({
  annotations,
  result,
  fosFilterMax,
  updateAnnotation,
}: {
  /** The selected colour bars. */
  annotations: Annotation[];
  result: AnalysisResult | null;
  /** The limit of Surfaces ▸ Filter by FOS, which the "filter" range follows. */
  fosFilterMax: number;
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void;
}) {
  const uid = useId();
  const fieldId = (key: string) => `${uid}-${key}`;
  const apply = useCallback(
    (patch: Partial<Annotation>) => {
      for (const anno of annotations) updateAnnotation(anno.id, patch);
    },
    [annotations, updateAnnotation],
  );

  const first = annotations[0];
  const modeValue = commonValue(annotations.map((a) => a.scaleMode ?? "auto"));
  const minValue = commonValue(annotations.map((a) => a.scaleMin));
  const maxValue = commonValue(annotations.map((a) => a.scaleMax));
  const schemeValue = commonValue(annotations.map((a) => a.scheme ?? "classic"));
  const fromValue = commonValue(annotations.map((a) => a.schemeFrom ?? CUSTOM_SCHEME_DEFAULTS.from));
  const toValue = commonValue(annotations.map((a) => a.schemeTo ?? CUSTOM_SCHEME_DEFAULTS.to));
  const midValue = commonValue(annotations.map((a) => a.schemeMid));
  const hasMid = commonValue(annotations.map((a) => a.schemeMid !== undefined));

  // The range the bar shows now (what the fields of a new mode start from).
  const shownRange = first && result ? colorBarRange(first, result, { fosFilterMax }) : null;
  const filterSpan = result && fosFilterMax > result.minFOS;
  const boundsInOrder = validFosScaleBounds(minValue, maxValue);
  const scheme = first ? colorBarScheme(first) : undefined;

  const setMode = (mode: ColorScaleMode) => {
    const seed: Partial<Annotation> = { scaleMode: mode };
    if (mode === "fixed") {
      // Start the bounds from the range on the bar, so nothing jumps.
      const base = shownRange ?? { min: 1, max: 2 };
      for (const anno of annotations) {
        updateAnnotation(anno.id, {
          ...seed,
          scaleMin: anno.scaleMin ?? round2(base.min),
          scaleMax: anno.scaleMax ?? round2(base.max),
        });
      }
      return;
    }
    apply(seed);
  };

  const setScheme = (id: FosSchemeId) => {
    if (id !== "custom") {
      apply({ scheme: id });
      return;
    }
    for (const anno of annotations) {
      updateAnnotation(anno.id, {
        scheme: "custom",
        schemeFrom: anno.schemeFrom ?? CUSTOM_SCHEME_DEFAULTS.from,
        schemeTo: anno.schemeTo ?? CUSTOM_SCHEME_DEFAULTS.to,
      });
    }
  };

  const toggleMid = (on: boolean) => {
    if (!on) {
      apply({ schemeMid: undefined });
      return;
    }
    for (const anno of annotations) {
      // The colour the two-colour blend has in the middle, to start from.
      const mid = fosSchemeColorAt({ id: "custom", from: anno.schemeFrom, to: anno.schemeTo }, 0.5);
      updateAnnotation(anno.id, { schemeMid: anno.schemeMid ?? mid });
    }
  };

  return (
    <div className="space-y-2" data-testid="color-bar-properties">
      <div>
        <label htmlFor={fieldId("range")} className={LABEL_CLASS} style={MUTED}>
          Range
        </label>
        <select
          id={fieldId("range")}
          value={modeValue ?? MIXED}
          onChange={(e) => {
            if (e.target.value === MIXED) return;
            setMode(e.target.value as ColorScaleMode);
          }}
          className="w-full"
        >
          {modeValue === undefined && <option value={MIXED}>Mixed values</option>}
          {RANGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {modeValue === "auto" && shownRange && (
          <p className="text-[10px] mt-0.5" style={MUTED}>
            F {shownRange.min.toFixed(2)} to {shownRange.max.toFixed(2)}
            {shownRange.capped ? " (surfaces above get the top color)" : ""}
          </p>
        )}
        {modeValue === "filter" && (
          <p className="text-[10px] mt-0.5" style={MUTED}>
            {result && filterSpan
              ? `F ${result.minFOS.toFixed(2)} to ${fosFilterMax.toFixed(2)}, the span of Surfaces › Filter by FOS.`
              : result
                ? `The filter limit (${fosFilterMax.toFixed(2)}) is not above the minimum F; the automatic range is used.`
                : "The span of Surfaces › Filter by FOS."}
          </p>
        )}
      </div>

      {modeValue === "fixed" && (
        <div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label htmlFor={fieldId("min-f")} className={LABEL_CLASS} style={MUTED}>
                Min F
              </label>
              <DraftNumberInput
                id={fieldId("min-f")}
                value={minValue}
                placeholder={minValue === undefined ? "Mixed" : ""}
                onValueChange={(v) => apply({ scaleMin: v })}
                className="w-full tabular-nums"
                step={0.1}
              />
            </div>
            <div className="flex-1">
              <label htmlFor={fieldId("max-f")} className={LABEL_CLASS} style={MUTED}>
                Max F
              </label>
              <DraftNumberInput
                id={fieldId("max-f")}
                value={maxValue}
                placeholder={maxValue === undefined ? "Mixed" : ""}
                onValueChange={(v) => apply({ scaleMax: v })}
                className="w-full tabular-nums"
                step={0.1}
              />
            </div>
          </div>
          {minValue !== undefined && maxValue !== undefined && !boundsInOrder && (
            <p role="alert" className="text-[10px] mt-1" style={{ color: "var(--color-vsc-error)" }}>
              Min F must be below max F; until then the automatic range is used.
            </p>
          )}
        </div>
      )}

      <div>
        <label htmlFor={fieldId("color-scheme")} className={LABEL_CLASS} style={MUTED}>
          Color scheme
        </label>
        <select
          id={fieldId("color-scheme")}
          value={schemeValue ?? MIXED}
          onChange={(e) => {
            if (e.target.value === MIXED) return;
            setScheme(e.target.value as FosSchemeId);
          }}
          className="w-full"
        >
          {schemeValue === undefined && <option value={MIXED}>Mixed values</option>}
          {FOS_SCHEME_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
        {scheme && (
          <div
            role="img"
            aria-label="Scheme preview, low F on the left"
            className="h-3 mt-1 rounded-sm"
            style={{ background: fosSchemeGradient(scheme), border: "1px solid var(--color-vsc-border)" }}
          />
        )}
      </div>

      {schemeValue === "custom" && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <ColorField label="From (low F)" value={fromValue} onChange={(hex) => apply({ schemeFrom: hex })} />
            <ColorField label="To (high F)" value={toValue} onChange={(hex) => apply({ schemeTo: hex })} />
          </div>
          <label className="flex items-center gap-1.5 text-[10px]" style={MUTED}>
            <input type="checkbox" checked={hasMid === true} onChange={(e) => toggleMid(e.target.checked)} />
            Add a middle color
          </label>
          {hasMid === true && (
            <div className="flex gap-2">
              <ColorField label="Middle" value={midValue} onChange={(hex) => apply({ schemeMid: hex })} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
