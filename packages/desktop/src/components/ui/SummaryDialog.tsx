import { useState } from "react";
import { ModalFrame } from "./ModalFrame";

interface Props {
  /** The dialog's heading, e.g. "Import from Dike.stix". */
  title: string;
  /** The summary, as plain text with line breaks; lines starting with "  – " are list items. */
  text: string;
  onClose: () => void;
}

type Block = { kind: "p"; text: string; gap: boolean } | { kind: "ul"; items: string[]; gap: boolean };

/** The summary's paragraphs and lists: "  – " lines become list items, a blank line a gap. */
function blocks(text: string): Block[] {
  const out: Block[] = [];
  let gap = false;
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      gap = out.length > 0;
      continue;
    }
    const item = /^\s+[–-]\s+(.*)$/.exec(line);
    const last = out[out.length - 1];
    if (item) {
      if (last?.kind === "ul" && !gap) last.items.push(item[1]);
      else out.push({ kind: "ul", items: [item[1]], gap });
    } else {
      out.push({ kind: "p", text: line, gap });
    }
    gap = false;
  }
  return out;
}

/**
 * A modal with a long plain-text summary (what an import or export did and
 * what did not carry over), scrollable, with a button that copies it as
 * plain text.
 */
export function SummaryDialog({ title, text, onClose }: Props) {
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("yes");
    } catch {
      setCopied("failed");
    }
  };

  return (
    <ModalFrame
      title={title}
      onClose={onClose}
      status={
        copied && (
          <span role="status">
            {copied === "yes" ? "Copied to the clipboard." : "Could not copy; select the text instead."}
          </span>
        )
      }
      buttons={
        <>
          <button type="button" onClick={() => void copy()} className="btn">
            Copy
          </button>
          <button type="button" onClick={onClose} className="btn btn-primary">
            Close
          </button>
        </>
      }
    >
      <div className="select-text" data-testid="summary-text">
        {blocks(text).map((b, i) =>
          b.kind === "p" ? (
            <p key={i} className={b.gap ? "mt-3" : i > 0 ? "mt-1" : undefined}>
              {b.text}
            </p>
          ) : (
            <ul key={i} className={`list-disc pl-5 flex flex-col gap-1 ${b.gap ? "mt-3" : "mt-1"}`}>
              {b.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          ),
        )}
      </div>
    </ModalFrame>
  );
}
