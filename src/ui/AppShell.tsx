"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AxisMark, Icon, type IconName } from "./Icon";
import { TestModeBanner } from "./primitives";

interface NavItem { href: string; label: string; icon: IconName; group: string }
const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: "grid", group: "Workspace" },
  { href: "/newsletters", label: "Newsletters", icon: "mail", group: "Workspace" },
  { href: "/content", label: "Content", icon: "article", group: "Workspace" },
  { href: "/content/inbox", label: "Review inbox", icon: "inbox", group: "Workspace" },
  { href: "/automations", label: "Automations", icon: "repeat", group: "Workspace" },
  { href: "/customers", label: "Customers", icon: "users", group: "Audience" },
  { href: "/segments", label: "Audiences", icon: "target", group: "Audience" },
  { href: "/communication", label: "Communication", icon: "globe", group: "Audience" },
  { href: "/reports", label: "Reports", icon: "chart", group: "Audience" },
  { href: "/sources", label: "Sources", icon: "globe", group: "Manage" },
  { href: "/operations", label: "Operations", icon: "settings", group: "Manage" },
  { href: "/help", label: "Help", icon: "help", group: "Manage" },
];
const ADMIN_NAV: NavItem[] = [
  { href: "/admin/users", label: "Users", icon: "shield", group: "Manage" },
  { href: "/admin/email-infrastructure", label: "Email setup", icon: "settings", group: "Manage" },
  { href: "/admin/qa-email", label: "QA email", icon: "flask", group: "Manage" },
];
const BARE_PATHS = ["/login", "/setup", "/unsubscribe", "/change-password", "/n"];
export interface ShellViewer { name: string | null; email: string; role: string }
const ROLE_LABEL: Record<string, string> = { ADMIN: "Administrator", MANAGER: "Manager" };

/** Navigation is display only. Every destination independently enforces server authorization. */
export function AppShell({ children, viewer, signOut, customerDeliveryConfigured = false }: { children: ReactNode; viewer: ShellViewer | null; signOut: () => Promise<void>; customerDeliveryConfigured?: boolean }) {
  const pathname = usePathname() ?? "/";
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const bare = BARE_PATHS.some(path => pathname === path || pathname.startsWith(`${path}/`)) || !viewer;
  const items = viewer?.role === "ADMIN" ? [...NAV, ...ADMIN_NAV] : NAV;
  // Longest match gives /content/inbox one active item, rather than two.
  const current = [...items].sort((a, b) => b.href.length - a.href.length).find(item => pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`)));

  useEffect(() => {
    if (bare) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setQuery("");
        dialog.current?.showModal();
        searchInput.current?.focus();
      }
      if (event.key === "Escape" && menuOpen) {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [bare, menuOpen]);

  if (pathname === "/n" || pathname.startsWith("/n/")) return <>{children}</>;
  if (bare) return <div className="bare-shell"><main>{children}</main><footer>AXIS GPS &amp; Mapping Solutions · Internal workspace</footer></div>;

  const matches = items.filter(item => `${item.label} ${item.group}`.toLowerCase().includes(query.toLowerCase().trim()));
  return (
    <div className="workspace-shell">
      <a href="#main-content" className="skip-link">Skip to content</a>
      <aside className={`workspace-sidebar ${menuOpen ? "is-open" : ""}`}>
        <Link href="/" className="axis-brand" onClick={() => setMenuOpen(false)}><AxisMark /><span>AXIS<span className="brand-caption">COMMUNICATION</span></span></Link>
        <div className="workspace-label"><span className="workspace-monogram">A</span><span>AXIS workspace<small>GPS &amp; Mapping Solutions</small></span><Icon name="chevron" size={14}/></div>
        <nav aria-label="Main" id="workspace-navigation">
          {["Workspace", "Audience", "Manage"].map(group => <div className="nav-group" key={group}><p>{group}</p>{items.filter(item => item.group === group).map(item => <Link key={item.href} href={item.href} aria-current={current?.href === item.href ? "page" : undefined} className="nav-link" onClick={() => setMenuOpen(false)}><Icon name={item.icon} size={18}/><span>{item.label}</span>{current?.href === item.href && <span className="nav-active-dot"/>}</Link>)}</div>)}
        </nav>
        <div className="sidebar-bottom"><Icon name="shield" size={17}/><div>Thoughtful communication<small>Review. Approve. Connect.</small></div></div>
      </aside>

      <div className="workspace-body">
        <header className="workspace-topbar">
          <button ref={menuButton} type="button" className="icon-button mobile-menu" aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} aria-controls="workspace-navigation" onClick={() => setMenuOpen(!menuOpen)}><Icon name={menuOpen ? "close" : "menu"}/></button>
          <div className="workspace-breadcrumb"><span>Workspace</span><Icon name="chevron" size={13}/><strong>{current?.label ?? "Workspace"}</strong></div>
          <button className="workspace-search" type="button" aria-label="Go to a page" onClick={() => { setQuery(""); dialog.current?.showModal(); searchInput.current?.focus(); }}><Icon name="search" size={17}/><span>Go to a page…</span><kbd>Ctrl K</kbd></button>
          <div className="viewer"><span className="viewer-avatar" aria-hidden="true">{(viewer.name ?? viewer.email).slice(0, 2).toUpperCase()}</span><div className="viewer-details"><strong>{viewer.name ?? viewer.email}</strong><span>{ROLE_LABEL[viewer.role] ?? viewer.role}</span></div></div>
          <form action={signOut}><button className="signout-button" type="submit" aria-label="Sign out" title="Sign out"><Icon name="logout" size={17}/><span>Sign out</span></button></form>
        </header>
        <TestModeBanner customerDeliveryConfigured={customerDeliveryConfigured}/>
        <main id="main-content" tabIndex={-1} className="workspace-main">{children}</main>
        <footer className="workspace-footer"><span>AXIS GPS &amp; Mapping Solutions</span><span>Customer data managed in Monday.com</span></footer>
      </div>

      <dialog ref={dialog} className="page-search-dialog" aria-labelledby="page-search-title" onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
        <div className="page-search-heading"><h2 id="page-search-title">Go to a page</h2><button type="button" className="icon-button" aria-label="Close page search" onClick={() => dialog.current?.close()}><Icon name="close"/></button></div>
        <label className="page-search-input"><Icon name="search"/><input ref={searchInput} aria-label="Find a workspace page" placeholder="Search pages…" value={query} onChange={event => setQuery(event.target.value)}/></label>
        <div className="page-search-results">{matches.length ? matches.map(item => <Link key={item.href} href={item.href} onClick={() => { dialog.current?.close(); setMenuOpen(false); }}><Icon name={item.icon}/><span>{item.label}<small>{item.group}</small></span><Icon name="arrow" size={16}/></Link>) : <p className="p-6 text-sm text-slate-500">No pages found. Try “content” or “audiences”.</p>}</div>
        <p className="page-search-footnote">Tab to a result · Enter to open · Esc to close</p>
      </dialog>
    </div>
  );
}
