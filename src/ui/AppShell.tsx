"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { TestModeBanner, buttonSubtle } from "./primitives";

/**
 * Application shell: primary navigation, the signed-in user, and the persistent
 * TEST-mode indicator.
 *
 * Client component only because the active link depends on the current path.
 *
 * `viewer` is passed in from the root layout, which reads it through the session DAL.
 * It is display data: hiding a nav item is a courtesy, and every page and action
 * re-checks permission on the server regardless of what this renders.
 */

const NAV = [
  { href: "/", label: "Dashboard", icon: "🏠" },
  { href: "/content", label: "Content", icon: "📝" },
  { href: "/content/inbox", label: "Review inbox", icon: "📥" },
  { href: "/sources", label: "Sources", icon: "🌐" },
  { href: "/newsletters", label: "Newsletters", icon: "✉️" },
  { href: "/automations", label: "Automations", icon: "🔁" },
  { href: "/customers", label: "Customers", icon: "👥" },
  { href: "/segments", label: "Audiences", icon: "🎯" },
  { href: "/communication", label: "Communication", icon: "🌐" },
  { href: "/reports", label: "Reports", icon: "📊" },
] as const;

/** Shown only to administrators. Server-side authorization is what enforces it. */
const ADMIN_NAV = [
  { href: "/admin/users", label: "Users", icon: "🔑" },
  { href: "/admin/email-infrastructure", label: "Email setup", icon: "📡" },
] as const;

/**
 * Screens that render without the application chrome.
 *
 * `/unsubscribe` is seen by a customer, who must not be shown AXIS navigation.
 * `/change-password` is the one page an account with an administrator-issued password
 * can reach, so offering links it cannot follow would only be confusing.
 */
const BARE_PATHS = [
  "/login",
  "/setup",
  "/unsubscribe",
  "/change-password",
] as const;

export interface ShellViewer {
  name: string | null;
  email: string;
  role: string;
}

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Administrator",
  MANAGER: "Manager",
};

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({
  children,
  viewer,
  signOut,
}: {
  children: ReactNode;
  viewer: ShellViewer | null;
  signOut: () => Promise<void>;
}) {
  const pathname = usePathname() ?? "/";
  const bare = BARE_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );

  // Anonymous screens (sign in, first-run setup) get no navigation: there is nothing
  // to navigate to, and showing links a visitor cannot follow is noise.
  if (bare || !viewer) {
    return (
      <div className="flex min-h-full flex-col">
        <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-10">{children}</main>
        <footer className="border-t border-slate-200 bg-white">
          <div className="mx-auto max-w-7xl px-6 py-5 text-xs text-slate-500">
            AXIS GPS &amp; Mapping Solutions — internal tool.
          </div>
        </footer>
      </div>
    );
  }

  const items = viewer.role === "ADMIN" ? [...NAV, ...ADMIN_NAV] : NAV;

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
            {items.map((item) => {
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

          <div className="ms-auto flex items-center gap-3">
            <div className="text-end">
              <p className="text-sm font-semibold text-slate-900">
                {viewer.name ?? viewer.email}
              </p>
              <p className="text-xs text-slate-500">
                {ROLE_LABEL[viewer.role] ?? viewer.role}
              </p>
            </div>
            <form action={signOut}>
              <button type="submit" className={buttonSubtle}>
                Sign out
              </button>
            </form>
          </div>
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
