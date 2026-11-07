"use client";
import { usePathname } from "next/navigation";

const LINKS = [
  ["/", "Ask"],
  ["/creators", "Creators"],
  ["/console", "AI app console"],
  ["/ledger", "Ledger"],
  ["/verify", "Verify a receipt"],
  ["/docs", "Docs"],
] as const;

export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {LINKS.map(([href, label]) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <a key={href} href={href} aria-current={active ? "page" : undefined}>
            {label}
          </a>
        );
      })}
    </nav>
  );
}
