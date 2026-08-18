import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

import { AppShell } from "../ui/AppShell";

/**
 * Root layout for the AXIS internal admin application.
 *
 * The admin shell is English/LTR for the MVP (see docs/requirements.md §9), but
 * the app is RTL-aware from the start: recipient-facing content and any future
 * localized (Hebrew/Arabic) surfaces render RTL. Prefer Tailwind *logical*
 * utilities (ms-*, me-*, ps-*, pe-*, text-start/end) over left/right so layouts
 * mirror correctly when `dir="rtl"` is applied to a subtree.
 */
export const metadata: Metadata = {
  title: "AXIS Customer Communication Platform",
  description:
    "Internal platform for AXIS GPS & Mapping Solutions — contacts, segmentation, and approved multilingual (Hebrew/Arabic) campaigns.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr" className="h-full antialiased">
      <body className="min-h-full bg-slate-50 text-slate-900">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
