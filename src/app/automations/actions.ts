"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import * as automationService from "../../server/services/automationService";

/**
 * Server actions for newsletter automations.
 *
 * Every one of these creates or configures a DRAFT-producing schedule. None sends,
 * approves, or chooses an audience — there is no service function reachable from here
 * that could.
 */

function back(params: Record<string, string>): never {
  redirect(`/automations?${new URLSearchParams(params).toString()}`);
}

function readInput(formData: FormData): automationService.AutomationInput {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : null;
  };
  const number = (name: string) => {
    const value = text(name);
    return value === null || value === "" ? null : Number(value);
  };

  return {
    name: text("name") ?? "",
    cadence: text("cadence") ?? "WEEKLY",
    interval: number("interval") ?? 1,
    dayOfWeek: number("dayOfWeek"),
    dayOfMonth: number("dayOfMonth"),
    hour: number("hour"),
    language: text("language") ?? "UNKNOWN",
    maxItems: number("maxItems") ?? 5,
    category: text("category"),
    sourceIds: formData
      .getAll("sourceIds")
      .filter((value): value is string => typeof value === "string"),
  };
}

export async function createAutomationAction(formData: FormData): Promise<void> {
  const result = await automationService.createAutomation(readInput(formData));
  revalidatePath("/automations");
  back(result.ok ? { created: "1" } : { error: result.errors[0].message });
}

export async function updateAutomationAction(formData: FormData): Promise<void> {
  const id = formData.get("id");
  if (typeof id !== "string") return;
  const result = await automationService.updateAutomation(id, readInput(formData));
  revalidatePath("/automations");
  back(result.ok ? { updated: "1" } : { error: result.errors[0].message });
}

export async function setAutomationEnabledAction(formData: FormData): Promise<void> {
  const id = formData.get("id");
  const enabled = formData.get("enabled");
  if (typeof id !== "string") return;

  const result = await automationService.setAutomationEnabled(id, enabled === "yes");
  revalidatePath("/automations");
  back(result.ok ? { updated: "1" } : { error: result.errors[0].message });
}

/**
 * "Run now" — collects from the automation's sources and, if approved content is
 * waiting, prepares a DRAFT. It cannot send.
 */
export async function runAutomationAction(formData: FormData): Promise<void> {
  const id = formData.get("id");
  if (typeof id !== "string") return;

  const result = await automationService.runAutomation(id);
  revalidatePath("/automations");
  revalidatePath("/content/inbox");
  revalidatePath("/newsletters");

  back({ ran: "1", status: result.status, message: result.message });
}
