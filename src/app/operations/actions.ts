"use server";
import { revalidatePath } from "next/cache";
import { configureCrmSchedule, retryCrmJob } from "../../server/services/jobService";
export async function operationAction(_state: { ok: boolean; message: string }, form: FormData) {
  try {
    if (form.get("operation") === "schedule") await configureCrmSchedule(form.get("enabled") === "on", Number(form.get("interval")));
    else if (form.get("operation") === "retry") await retryCrmJob(String(form.get("jobId") ?? ""));
    else return { ok: false, message: "Choose an operation." };
    revalidatePath("/operations");
    return { ok: true, message: "Instruction recorded. Refresh to see progress." };
  } catch { return { ok: false, message: "This instruction could not be recorded. Check your permissions and the current job state. Sync intervals must be 15–1440 minutes." }; }
}
