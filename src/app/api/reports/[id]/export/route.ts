import { exportCampaignReport } from "../../../../../server/services/reportService";
import { NotAuthenticatedError, NotAuthorizedError } from "../../../../../domain/auth/authorization";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  try {
    const { id } = await context.params;
    const csv = await exportCampaignReport(id);
    if (csv === null) return new Response("Report not found.", { status: 404, headers });
    return new Response("\ufeff" + csv, { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="axis-delivery-report.csv"' } });
  } catch (error) {
    return new Response("Report unavailable.", { status: error instanceof NotAuthenticatedError ? 401 : error instanceof NotAuthorizedError ? 403 : 400, headers });
  }
}
