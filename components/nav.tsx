"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "@/app/sign-out-button";

const LINKS = [
  { href: "/", label: "Week" },
  { href: "/projects", label: "Projects" },
  { href: "/ideas", label: "Ideas" },
  { href: "/hygiene", label: "Hygiene" },
  { href: "/reports", label: "Reports" },
  { href: "/settings", label: "Settings" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-slate/95 px-6 py-3 shadow-sm backdrop-blur">
      <nav className="flex items-center gap-1">
        <span className="mr-3 flex items-center gap-2 pr-2 text-sm font-bold tracking-tight text-chalk">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-xs font-bold text-on-accent shadow-sm">WP</span>
          Weekly Planner
        </span>
        {LINKS.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={
                active
                  ? "rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent shadow-sm"
                  : "rounded-lg px-3 py-1.5 text-sm text-chalk-dim hover:bg-surface-hover hover:text-chalk"
              }
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
      <SignOutButton />
    </header>
  );
}
