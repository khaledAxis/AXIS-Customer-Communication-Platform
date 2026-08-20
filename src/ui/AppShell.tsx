"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { TestModeBanner } from "./primitives";

/**
 * Application shell: primary navigation + the persistent TEST-mode indicator.
 *
 * Client component only because the active link depends on the current path.
 */

const NAV = [
  { href: "/", label: "Dashboard", icon: "🏠" },
  { href: "/content", label: "Content", icon: "📝" },
  { href: "/newsletters", label: "Newsletters", icon: "✉️" },
  { href: "/automations", label: "Automations", icon: "🔁" },
  { href: "/customers", label: "Customers", icon: "👥" },
  { href: "/segments", label: "Audiences", icon: "🎯" },
  { href: "/communication", label: "Communication", icon: "🌐" },
  { href: "/reports", label: "Reports", icon: "📊" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";

  return (
    <div className="flex min-h-full flex-col">
      <TestModeBanner />

      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-8 gap-y-3 px-6 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="grid h-9 w-9 place-items-center rounded-lg bg-slate-900 text-sm font-black text-white"
            >
              AX
            </span>
            <span className="text-base font-bold tracking-tight text-slate-900">
              AXIS Communication
            </span>
          </Link>

          <nav aria-label="Main" className="flex flex-wrap items-center gap-1">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                    active
                      ? "bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-200"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  <span aria-hidden>{item.icon}</span>
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-10">{children}</main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-5 text-xs text-slate-500">
          AXIS GPS &amp; Mapping Solutions — internal tool. Customer data is managed in Monday.com.
        </div>
      </footer>
    </div>
  );
}
