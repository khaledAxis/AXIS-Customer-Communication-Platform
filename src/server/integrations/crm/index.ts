import type { CrmSource } from "./crmSource";
import { MondayCrmSource } from "./mondayCrmSource";

/**
 * The single place that decides which CrmSource implementation is used.
 * Monday is the source of truth (ADR-0007); this port is read-only (ADR-0017).
 */

let source: CrmSource | undefined;
let override: CrmSource | undefined;

export function getCrmSource(): CrmSource {
  if (override) return override;
  if (!source) source = new MondayCrmSource();
  return source;
}

/** Test seam. Injecting a fake keeps the suite offline — no test can reach Monday. */
export function setCrmSourceForTesting(next: CrmSource | undefined): void {
  override = next;
  source = undefined;
}

export * from "./crmSource";
