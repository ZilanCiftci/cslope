/**
 * PreToolUse hook for the GitHub MCP tool `issue_write`: an issue created
 * (or a body replaced) by Claude must have the sections of "Issues written
 * by Claude" in .claude/workflow.md. Exit code 2 blocks the call and the
 * message goes back to Claude, which completes the issue and tries again.
 */
type Input = { tool_name?: string; tool_input?: { method?: string; body?: string; labels?: string[]; title?: string } };

const raw = await new Response(Bun.stdin.stream()).text();
let input: Input = {};
try {
  input = JSON.parse(raw);
} catch {
  process.exit(0);
}
const t = input.tool_input ?? {};
// Only a new issue, or an update that replaces the body.
if (t.method !== "create" && !(t.method === "update" && typeof t.body === "string")) process.exit(0);

const body = t.body ?? "";
const labels = (t.labels ?? []).map((l) => l.toLowerCase());
const has = (heading: string) => new RegExp(`^##\\s+${heading}\\b`, "im").test(body);
const isBug = labels.some((l) => l === "bug" || l === "wrong-result" || l === "import-export");
const looks = labels.includes("ui");

const missing: string[] = [];
for (const h of ["Summary", "Plan", "Done when", "Related"]) if (!has(h)) missing.push(`## ${h}`);
if (isBug) for (const h of ["Steps to reproduce", "Observed", "Cause"]) if (!has(h)) missing.push(`## ${h}`);
if (has("Done when") && !/^\s*- \[ \]/m.test(body.split(/^##\s+Done when/im)[1] ?? "")) missing.push("a checklist (- [ ] …) under ## Done when");
if ((isBug || looks) && !/!\[[^\]]*\]\(https?:\/\//.test(body) && !/```/.test(body)) missing.push("evidence: a screenshot (![…](https://raw.githubusercontent.com/ZilanCiftci/cslope/issue-assets/…)) or output in a code block");
if (labels.length === 0 && t.method === "create") missing.push("labels: one type label and a size (see .github/labels.json)");

if (missing.length > 0) {
  console.error(
    `This issue does not meet "Issues written by Claude" (.claude/workflow.md); use the issue skill. Missing: ${missing.join("; ")}.`,
  );
  process.exit(2);
}
process.exit(0);
