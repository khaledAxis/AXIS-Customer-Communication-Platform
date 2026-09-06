/** Reports use UTC campaign-creation cohorts and unique recipient facts. */
export function reportRange(from?: string, to?: string, now = new Date()) {
  const parse = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Use a valid date.");
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("Use a valid date.");
    return date;
  };
  const end = parse(to || now.toISOString().slice(0, 10));
  const start = from ? parse(from) : new Date(end.getTime() - 89 * 86400000);
  if (start > end || end.getTime() - start.getTime() > 365 * 86400000) throw new Error("Choose a date range of at most 366 days.");
  return { from: start, until: new Date(end.getTime() + 86400000), fromLabel: start.toISOString().slice(0, 10), toLabel: end.toISOString().slice(0, 10) };
}

/** Spreadsheet formula injection is refused as data, including leading whitespace. */
export function csvCell(value: unknown): string {
  let text = value == null ? "" : value instanceof Date ? value.toISOString() : String(value);
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}

export const DELIVERY_LABELS: Record<string, string> = {
  PENDING: "Prepared", READY: "Ready", SENDING: "Submitting", ACCEPTED: "Accepted",
  DELIVERED: "Delivered", BOUNCED: "Bounced", COMPLAINED: "Spam complaint", FAILED: "Failed",
  UNCERTAIN: "Outcome unknown", SUPPRESSED: "Suppressed", SENT: "Legacy submission",
};
