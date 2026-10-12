/**
 * Reads CHANGELOG.md at the repository root: "## [version] - date"
 * headings, optional "### group" headings and "- item" lists. Used by the
 * changelog page and, through scripts/changelog.ts, by the release workflow
 * for the release notes.
 */

export interface ChangelogGroup {
  title: string | null;
  items: string[];
}

export interface ChangelogRelease {
  version: string;
  /** The date, or "Unreleased". */
  date: string | null;
  summary: string[];
  groups: ChangelogGroup[];
}

export function parseChangelog(text: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  let release: ChangelogRelease | null = null;
  let group: ChangelogGroup | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const head = line.match(/^## \[([^\]]+)\](?:\s+-\s+(.+))?$/);
    if (head) {
      release = { version: head[1], date: head[2] ?? null, summary: [], groups: [] };
      releases.push(release);
      group = null;
      continue;
    }
    if (!release) continue;
    const sub = line.match(/^### (.+)$/);
    if (sub) {
      group = { title: sub[1], items: [] };
      release.groups.push(group);
      continue;
    }
    const item = line.match(/^[-*] (.+)$/);
    if (item) {
      if (!group) {
        group = { title: null, items: [] };
        release.groups.push(group);
      }
      group.items.push(item[1]);
    } else if (line && !group) {
      release.summary.push(line);
    }
  }
  return releases;
}

/** One release's notes as Markdown, for a GitHub release. */
export function releaseNotes(text: string, version: string): string {
  const r = parseChangelog(text).find((x) => x.version === version.replace(/^v/, ""));
  if (!r) throw new Error(`CHANGELOG.md has no section for ${version}`);
  return [
    ...r.summary,
    ...r.groups.flatMap((g) => ["", ...(g.title ? [`### ${g.title}`, ""] : []), ...g.items.map((i) => `- ${i}`)]),
  ]
    .join("\n")
    .trim();
}
