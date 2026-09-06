import { NextResponse } from "next/server";
import { readBoundedText } from "../../../../server/services/boundedRequest";

import { receiveProviderWebhook } from "../../../../server/services/providerWebhookService";

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

  // Raw text, never `request.json()`: parsing and re-serialising would change the
  // bytes and break — or worse, silently alter — what the signature protects.
  let rawBody: string;
  try {
    rawBody = await readBoundedText(request);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const headers: Record<string, string | undefined> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  try {
    const result = await receiveProviderWebhook(rawBody, headers);
    return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ ok: false }, { status: 503 }); }
}

/**
 * Explicitly refused. A webhook endpoint that answered GET would be a way to probe
 * whether it exists and what it does.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: false }, { status: 405 });
}
