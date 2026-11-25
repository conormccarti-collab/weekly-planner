import type { ReactNode } from "react";

function renderInline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>
  );
}

/** A small, dependency-free renderer for the chat model's own replies: headings, **bold**, and "- " bullet lists. */
export function ChatMarkdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let listItems: string[] = [];
  let key = 0;

  function flushList() {
    if (listItems.length === 0) return;
    const items = listItems;
    blocks.push(
      <ul key={key++} className="list-disc space-y-0.5 pl-4">
        {items.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ul>
    );
    listItems = [];
  }

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "") {
      flushList();
      continue;
    }
    const headingMatch = line.match(/^(#{1,3})\s+(.*)/);
    if (headingMatch) {
      flushList();
      const isTopLevel = headingMatch[1].length === 1;
      blocks.push(
        <p key={key++} className={isTopLevel ? "mt-1.5 font-bold first:mt-0" : "mt-1.5 text-xs font-bold uppercase tracking-wide text-chalk-dim first:mt-0"}>
          {renderInline(headingMatch[2])}
        </p>
      );
      continue;
    }
    const bulletMatch = line.match(/^[-*]\s+(.*)/);
    if (bulletMatch) {
      listItems.push(bulletMatch[1]);
      continue;
    }
    flushList();
    blocks.push(<p key={key++}>{renderInline(line)}</p>);
  }
  flushList();

  return <div className="space-y-1">{blocks}</div>;
}
