/**
 * Foundation landing page (Milestone 0).
 *
 * Intentionally minimal: it confirms the app builds and demonstrates the
 * RTL-aware baseline. Real features arrive per docs/development-plan.md and
 * must not be added ahead of their milestone.
 */
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium uppercase tracking-wide text-foreground/60">
          Internal tool · Milestone 0 — Foundation
        </p>
        <h1 className="text-3xl font-semibold">
          AXIS Customer Communication Platform
        </h1>
        <p className="text-foreground/70">
          Contacts, segmentation, and approved multilingual (Hebrew &amp; Arabic)
          campaigns for AXIS GPS &amp; Mapping Solutions.
        </p>
      </header>

      <section className="rounded-lg border border-foreground/10 p-5">
        <h2 className="mb-2 text-lg font-medium">Project foundation is ready</h2>
        <p className="text-sm text-foreground/70">
          The engineering foundation, architecture, and documentation are in
          place. Feature modules are implemented milestone by milestone.
        </p>
        <ul className="mt-4 list-inside list-disc text-sm text-foreground/80">
          <li>Operating manual: CLAUDE.md</li>
          <li>Requirements, architecture, and plan: docs/</li>
          <li>Decisions: docs/decisions/ (ADRs)</li>
        </ul>
      </section>

      {/* RTL-awareness baseline: this subtree renders right-to-left. */}
      <section
        dir="rtl"
        lang="he"
        className="rounded-lg border border-foreground/10 p-5"
      >
        <h2 className="mb-2 text-lg font-medium">בדיקת כיווניות (RTL)</h2>
        <p className="text-sm text-foreground/70">
          תוכן בעברית ובערבית מוצג מימין לשמאל. שימוש בתכונות לוגיות של Tailwind
          מבטיח פריסה נכונה בשתי השפות.
        </p>
      </section>
    </main>
  );
}
