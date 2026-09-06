import { receiveMondayWebhook } from "../../../../server/services/mondayWebhookService";
import { readBoundedJson } from "../../../../server/services/boundedRequest";
export async function POST(request: Request) {
  let body: unknown;
  try { body = await readBoundedJson(request); }
  catch { return Response.json({ status: "unavailable" }, { status: 400 }); }
  try {
    const result = await receiveMondayWebhook(body, request.headers.get("authorization"));
    return Response.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ status: "unavailable" }, { status: 503 }); }
}
