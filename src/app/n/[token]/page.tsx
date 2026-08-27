import { getPublicNewsletter } from "../../../server/services/publicNewsletterService";

/**
 * The public web version of a newsletter (ADR-0032).
 *
 * PUBLIC BY NECESSITY. A recipient has no AXIS account and never will; the opaque
 * token in the URL is the entire authorization, exactly as with unsubscribe
 * (ADR-0024). `/n` is listed in `src/proxy.ts` alongside the other public prefixes.
 *
 * It renders the SAME HTML the email renders, so the promise the "View as webpage"
 * link makes is literally true. Nothing else is on the page: no navigation, no
 * status, no audience data, no controls — a visitor learns exactly what a recipient
 * of the email would learn.
 *
 * An unknown and a malformed token produce the identical page, so this never becomes
 * a way to discover which newsletters exist.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "AXIS newsletter",
  // A newsletter is written for the people it was sent to, not for search engines.
  robots: { index: false, follow: false },
};

export default async function PublicNewsletterPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const newsletter = await getPublicNewsletter(token);

  if (!newsletter) {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#eef1f5",
          fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif",
          padding: "24px",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: "26rem" }}>
          <p style={{ fontSize: "18px", fontWeight: 700, color: "#0f172a", margin: 0 }}>
            This newsletter is not available.
          </p>
          <p style={{ marginTop: "8px", fontSize: "14px", color: "#64748b" }}>
            The link may have expired, or it may have been copied incompletely.
          </p>
        </div>
      </main>
    );
  }

  // The rendered email is a COMPLETE document. It is shown inside a sandboxed frame
  // rather than injected into this page: the newsletter carries its own <html>, its
  // own styles and its own direction, and `srcDoc` keeps all of that intact while
  // `sandbox` without `allow-scripts` means nothing in it can execute.
  return (
    <main style={{ margin: 0, padding: 0, background: "#eef1f5" }}>
      <iframe
        title={newsletter.subject}
        srcDoc={newsletter.html}
        sandbox=""
        style={{
          display: "block",
          width: "100%",
          height: "100vh",
          border: 0,
        }}
      />
    </main>
  );
}
