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
    <header className="flex items-center justify-between border-b border-border px-6 py-3">
      <nav className="flex items-center gap-5">
        <span className="pr-2 text-sm font-semibold text-chalk">Weekly Planner</span>
        {LINKS.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={
                active
                  ? "text-sm font-medium text-accent"
                  : "text-sm text-chalk-dim hover:text-chalk"
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
