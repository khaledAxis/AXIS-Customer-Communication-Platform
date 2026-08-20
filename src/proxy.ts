import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge gate for unauthenticated traffic (Next.js 16 `proxy` convention — the file
 * formerly called `middleware`).
 *
 * WHAT THIS IS: a cheap first pass that bounces anonymous requests to `/login`
 * before a page renders, including requests arriving from another machine on the
 * office LAN.
 *
 * WHAT THIS IS NOT: the security boundary. It only checks that a session cookie
 * EXISTS — it does not verify the signature, does not read a role, and cannot know
 * whether the account was deactivated a minute ago. Every protected page and every
 * server action independently calls the session DAL (`server/auth/session.ts`),
 * which re-reads the user row and decides properly. Both the Next.js authentication
 * guide and CLAUDE.md say the same thing: the real check belongs next to the data.
 *
 * Deliberately public:
 *  - `/login` and `/setup`, or nobody could ever sign in or create the first admin;
 *  - `/api/auth/*`, the Auth.js endpoints that establish a session;
 *  - `/api/media/*`, which serves newsletter images. A recipient's email client is
 *    anonymous by definition, so requiring a session there would break every picture
 *    in a delivered newsletter. (Cloudinary-hosted images never touch this app.)
 *  - `/unsubscribe/*`, for the same reason: the person following that link is a
 *    customer, not a member of staff. Possession of an unguessable token is what
 *    authorizes the action, and the endpoint reveals nothing to anyone without one.
 */

/** Paths that must work without a session. */
const PUBLIC_PREFIXES = [
  "/login",
  "/setup",
  "/api/auth",
  "/api/media",
  // A recipient unsubscribing has no AXIS account and never will (ADR-0024). The
  // token in the URL is the entire authorization, and it is validated server-side.
  "/unsubscribe",
  // Resend posts delivery events with no AXIS session and never will (ADR-0025). The
  // Standard Webhooks signature is the entire authorization, verified in the route
  // BEFORE the body is read; an unsigned request is refused there with 401.
  "/api/webhooks",
] as const;

/** Auth.js cookie names, host-prefixed variant included (used behind HTTPS). */
const SESSION_COOKIES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
] as const;

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function hasSessionCookie(request: NextRequest): boolean {
  return SESSION_COOKIES.some((name) => Boolean(request.cookies.get(name)?.value));
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();
  if (hasSessionCookie(request)) return NextResponse.next();

  // Remember where they were going, so signing in lands them there rather than on
  // the dashboard. The value is a same-origin path only — `/login` re-validates it.
  const login = new URL("/login", request.nextUrl);
  const target = `${pathname}${search}`;
  if (target !== "/") login.searchParams.set("next", target);

  return NextResponse.redirect(login);
}

export const config = {
  /**
   * Everything except Next's own static output and the favicon. Auth is one of the
   * few cases where running on all routes is the right default — an omission here is
   * a hole, not a performance win.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
