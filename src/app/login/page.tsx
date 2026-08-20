import { redirect } from "next/navigation";

import { getCurrentActor } from "../../server/auth/session";
import { hasRealAdministrator } from "../../server/services/bootstrapService";
import { LoginForm } from "../../ui/AuthForms";
import { signInAction } from "./actions";

/**
 * Sign-in screen.
 *
 * Public by necessity. When no administrator exists yet it points at `/setup`
 * instead, so a fresh installation has one obvious next step rather than a login form
 * nobody can satisfy.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in — AXIS Communication" };

type Search = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  if (!(await hasRealAdministrator())) redirect("/setup");

  // Already signed in? Nothing to do here.
  const actor = await getCurrentActor();
  if (actor) redirect("/");

  const params = await searchParams;
  const rawNext = one(params.next);
  const next = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  const notice =
    one(params.created) === "1"
      ? "Administrator account created. Sign in with the password you just chose."
      : one(params.signedout) === "1"
        ? "You have been signed out."
        : one(params.expired) === "1"
          ? "Your session ended. Please sign in again."
          : null;

  return (
    <div className="flex min-h-[70vh] items-center py-10">
      <LoginForm action={signInAction} next={next} notice={notice} />
    </div>
  );
}
