import { isApplicationReady } from "../../../../server/services/healthService";
export const dynamic = "force-dynamic";
export async function GET() {
  const ready = await isApplicationReady();
  return Response.json({ status: ready ? "ok" : "unavailable" }, {
    status: ready ? 200 : 503,
    headers: { "Cache-Control": "no-store", ...(ready ? {} : { "Retry-After": "5" }) },
  });
}

