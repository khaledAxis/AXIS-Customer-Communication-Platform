import { NextResponse } from "next/server";

import { getProductionEmailProvider } from "../../../../server/integrations/email";
import { ingestProviderEvent } from "../../../../server/services/providerEventService";

/**
 * The Resend delivery-event endpoint (ADR-0025).
 *
 * Public by necessity — Resend has no AXIS session — and therefore treated as hostile
 * input. The order below is the whole security design:
 *
 *   1. read the RAW body (a re-serialised body changes the bytes the signature covers);
 *   2. VERIFY the signature;
 *   3. only then look at what the event says.
 *
 * Nothing before step 2 touches the database. An endpoint that acted first and verified
 * afterwards would let anyone on the internet suppress an AXIS customer by posting a
 * fabricated bounce.
 *
 * Rejections say nothing. No recipient address, no campaign, no reason — a probe
 * learns only that the request was refused, which is all it is entitled to know.
 */

export const runtime = "nodejs";
// Signature verification covers the exact bytes sent, so this route can never be
// pre-rendered, cached, or served from a stored response.
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const provider = getProductionEmailProvider();

  // Raw text, never `request.json()`: parsing and re-serialising would change the
  // bytes and break — or worse, silently alter — what the signature protects.
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const headers: Record<string, string | undefined> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const verification = provider.verifyWebhook({ rawBody, headers });

  if (!verification.ok) {
    // 401, and NO state change of any kind. Deliberately not 400: an unverifiable
    // request is an authentication failure, not a malformed one.
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // Verified. Now — and only now — the payload may be acted on.
  let applied = 0;
  for (const event of verification.events) {
    const outcome = await ingestProviderEvent(event);
    if (outcome.ok && !outcome.duplicate) applied += 1;
  }

  // 200 even for a duplicate or an event we do not act on: anything else makes Resend
  // retry forever, and a retry storm is its own outage.
  return NextResponse.json({ ok: true, applied }, { status: 200 });
}

/**
 * Explicitly refused. A webhook endpoint that answered GET would be a way to probe
 * whether it exists and what it does.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: false }, { status: 405 });
}
