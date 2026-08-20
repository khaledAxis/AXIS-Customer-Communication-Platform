import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

import { getCurrentActor } from "../server/auth/session";
import { AppShell } from "../ui/AppShell";
import { signOutAction } from "./login/actions";

/**
 * Root layout for the AXIS internal admin application.
 *
 * The admin shell is English/LTR for the MVP (see docs/requirements.md §9), but
 * the app is RTL-aware from the start: recipient-facing content and any future
 * localized (Hebrew/Arabic) surfaces render RTL. Prefer Tailwind *logical*
 * utilities (ms-*, me-*, ps-*, pe-*, text-start/end) over left/right so layouts
 * mirror correctly when `dir="rtl"` is applied to a subtree.
 *
 * The signed-in person is read here, once, through the session DAL and passed to the
 * shell as display data. It decides what the navigation shows — never what anyone is
 * allowed to do; that is re-checked on the server by every page and action.
 */
export const metadata: Metadata = {
  title: "AXIS Customer Communication Platform",
  description:
    "Internal platform for AXIS GPS & Mapping Solutions — contacts, segmentation, and approved multilingual (Hebrew/Arabic) campaigns.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const actor = await getCurrentActor();

  return (
    <html lang="en" dir="ltr" className="h-full antialiased">
      <body className="min-h-full bg-slate-50 text-slate-900">
        <AppShell
          viewer={
            actor ? { name: actor.name, email: actor.email, role: actor.role } : null
          }
          signOut={signOutAction}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
