import { handlers } from "../../../../server/auth/config";

/**
 * Auth.js endpoint (session, CSRF, callback). Public by necessity — this is the
 * route that establishes a session in the first place, so `src/proxy.ts` lets it
 * through. It never returns a password hash; Auth.js only ever emits the session
 * payload the callbacks in `server/auth/config.ts` build, which is a user id.
 */
export const runtime = "nodejs";

export const { GET, POST } = handlers;
