import { runJobTick, schedulerAuthorized } from "../../../../../server/services/jobService";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function POST(request: Request) {
  if (!schedulerAuthorized(request.headers.get("authorization")))
    return Response.json({ status: "unavailable" }, { status: 401 });
  try { return Response.json(await runJobTick(), { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ status: "unavailable" }, { status: 503 }); }
}
