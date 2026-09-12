// Minimal markdown -> React for the coaching report (headings, bullets, numbered items, bold, links). No deps.
import type { ReactNode } from "react";

function inline(text: string, key: number): ReactNode {
  const parts: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) parts.push(<strong key={`${key}-${i++}`}>{m[1]}</strong>);
    else parts.push(<a key={`${key}-${i++}`} href={m[3]} target="_blank" rel="noreferrer">{m[2]}</a>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function Markdown({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = () => { if (list.length) { out.push(<ul key={`ul-${out.length}`}>{list}</ul>); list = []; } };
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) { flush(); return; }
    if (line.startsWith("## ")) { flush(); out.push(<h2 key={i}>{line.slice(3)}</h2>); return; }
    if (line.startsWith("# ")) { flush(); out.push(<h2 key={i}>{line.slice(2)}</h2>); return; }
    const li = line.match(/^(?:[-*]|\d+\.)\s+(.*)$/);
    if (li) { list.push(<li key={i}>{inline(li[1], i)}</li>); return; }
    flush();
    out.push(<p key={i}>{inline(line, i)}</p>);
  });
  flush();
  return <>{out}</>;
}
