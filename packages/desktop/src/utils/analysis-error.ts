/**
 * The message of a failed analysis, for one line in the status bar and
 * the result panel: the engine lists a material's invalid values on lines
 * of their own ("Material "Clay" has invalid model:\n  – …"), which read
 * as "Material "Clay" has invalid model: – …" once the lines are joined.
 * Here they become "Material "Clay": …; …".
 */
export function analysisErrorText(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(
    /(Material "[^"]*") has invalid model:((?:\s*\n\s*[–-]\s*[^\n]*)+)/g,
    (_, material: string, list: string) =>
      `${material}: ${list
        .split(/\n\s*[–-]\s*/)
        .map((s) => s.trim())
        .filter(Boolean)
        .join(" ")}`,
  );
}
