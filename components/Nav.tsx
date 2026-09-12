"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// One nav for every page: logo + Home · Dashboard · Journal. Extra page-specific actions go in `right`.
export function Nav({ right }: { right?: React.ReactNode }) {
  const path = usePathname();
  const items = [
    ["/", "Home"],
    ["/dashboard/latest", "Dashboard"],
    ["/audits", "Audits"],
    ["/journal", "Journal"],
  ] as const;
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href.replace("/latest", "")));
  return (
    <header className="no-print mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 py-5">
      <div className="flex items-center gap-6">
        <Link href="/" className="flex items-center"><img src="/logo.png" alt="TradeAudit" className="h-7 w-auto" /></Link>
        <nav className="flex items-center gap-1 text-sm">
          {items.map(([href, label]) => (
            <Link key={href} href={href} className={`rounded-full px-3 py-1.5 transition-colors ${active(href) ? "bg-muted font-medium text-ink" : "text-ink-3 hover:text-ink"}`}>{label}</Link>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-2">{right}</div>
    </header>
  );
}
