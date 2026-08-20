"use client";

import { useActionState, useState } from "react";

import type { UserAdminFormState } from "../app/admin/users/actions";
import { MIN_PASSWORD_LENGTH } from "../domain/auth/passwordPolicy";
import type { StaffAccount } from "../server/services/userService";
import { formatDate } from "./labels";
import {
  Badge,
  Card,
  buttonPrimary,
  buttonSecondary,
  buttonSubtle,
  inputClass,
} from "./primitives";

/**
 * Staff account administration.
 *
 * What this screen deliberately cannot show: a password or a password hash. The
 * `StaffAccount` type it receives has no such field, so there is nothing to render
 * even by accident, and a password only ever travels one way — from this form to the
 * server, where it is hashed.
 *
 * Accounts are deactivated, never deleted. A person who approved a newsletter last
 * year must still be nameable this year, so their row stays and their history stays
 * attached to it.
 */

type FormAction = (
  state: UserAdminFormState,
  formData: FormData,
) => Promise<UserAdminFormState>;

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Administrator",
  MANAGER: "Manager",
};

function Result({ state }: { state: UserAdminFormState }) {
  if (!state.message) return null;
  return (
    <div
      role="status"
      className={`mt-3 rounded-lg border p-3 text-sm ${
        state.ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
          : "border-rose-200 bg-rose-50 text-rose-900"
      }`}
    >
      <p className="font-semibold">{state.message}</p>
      {state.issues.length > 0 ? (
        <ul className="mt-1.5 list-disc space-y-0.5 ps-5">
          {state.issues.map((issue, index) => (
            <li key={`${issue}-${index}`}>{issue}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function UserAdminPanel({
  accounts,
  viewerId,
  createAction,
  resetAction,
  setRoleAction,
  setActiveAction,
}: {
  accounts: StaffAccount[];
  viewerId: string;
  createAction: FormAction;
  resetAction: FormAction;
  setRoleAction: (formData: FormData) => Promise<void>;
  setActiveAction: (formData: FormData) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [resettingId, setResettingId] = useState<string | null>(null);

  const [createState, createFormAction, createPending] = useActionState(
    createAction,
    { ok: false, message: "", issues: [] },
  );
  const [resetState, resetFormAction, resetPending] = useActionState(resetAction, {
    ok: false,
    message: "",
    issues: [],
  });

  const staff = accounts.filter((account) => !account.isSystemAccount);
  const system = accounts.filter((account) => account.isSystemAccount);

  return (
    <div className="space-y-6">
      {/* ----------------------------- create ----------------------------- */}
      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Add a staff account</h2>
            <p className="mt-1 text-sm text-slate-600">
              There is no public sign-up. Every account is created here, by an
              administrator.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreating((open) => !open)}
            className={creating ? buttonSecondary : buttonPrimary}
          >
            {creating ? "Cancel" : "New account"}
          </button>
        </div>

        {creating ? (
          <form action={createFormAction} className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-semibold text-slate-800">Name</span>
              <input type="text" name="name" required className={`${inputClass} mt-1.5`} />
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-slate-800">Email address</span>
              <input
                type="email"
                name="email"
                required
                dir="ltr"
                className={`${inputClass} mt-1.5`}
              />
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-slate-800">Role</span>
              <select name="role" defaultValue="MANAGER" className={`${inputClass} mt-1.5`}>
                <option value="MANAGER">Manager — runs communication work</option>
                <option value="ADMIN">Administrator — also manages accounts</option>
              </select>
            </label>

            <div className="hidden sm:block" />

            <label className="block">
              <span className="text-sm font-semibold text-slate-800">
                Initial password
              </span>
              <input
                type="password"
                name="password"
                autoComplete="new-password"
                required
                className={`${inputClass} mt-1.5`}
              />
              <span className="mt-1 block text-xs text-slate-500">
                At least {MIN_PASSWORD_LENGTH} characters, upper and lower case, and a
                number.
              </span>
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-slate-800">
                Confirm password
              </span>
              <input
                type="password"
                name="confirmPassword"
                autoComplete="new-password"
                required
                className={`${inputClass} mt-1.5`}
              />
            </label>

            <div className="sm:col-span-2">
              <button type="submit" className={buttonPrimary} disabled={createPending}>
                {createPending ? "Creating…" : "Create account"}
              </button>
              <span className="ms-3 text-xs text-slate-500">
                Hand the password over in person or through a password manager. It is
                never shown again.
              </span>
            </div>
          </form>
        ) : null}

        <Result state={createState} />
      </Card>

      {/* ------------------------------ list ------------------------------ */}
      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="px-4 py-2.5 text-start font-semibold text-slate-700">
                  Person
                </th>
                <th className="px-4 py-2.5 text-start font-semibold text-slate-700">
                  Role
                </th>
                <th className="px-4 py-2.5 text-start font-semibold text-slate-700">
                  State
                </th>
                <th className="px-4 py-2.5 text-start font-semibold text-slate-700">
                  Last signed in
                </th>
                <th className="px-4 py-2.5 text-start font-semibold text-slate-700">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {staff.map((account) => {
                const isSelf = account.id === viewerId;
                return (
                  <tr key={account.id} className={account.isActive ? "" : "bg-slate-50/60"}>
                    <td className="px-4 py-3 align-top">
                      <p className="font-medium text-slate-900">
                        {account.name ?? "—"}
                        {isSelf ? (
                          <span className="ms-2 text-xs font-normal text-slate-500">
                            (you)
                          </span>
                        ) : null}
                      </p>
                      <p className="break-all text-xs text-slate-500" dir="ltr">
                        {account.email}
                      </p>
                    </td>

                    <td className="px-4 py-3 align-top">
                      <form action={setRoleAction} className="flex items-center gap-1.5">
                        <input type="hidden" name="userId" value={account.id} />
                        <select
                          name="role"
                          defaultValue={account.role}
                          key={account.role}
                          aria-label={`Role for ${account.email}`}
                          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                        >
                          <option value="MANAGER">{ROLE_LABEL.MANAGER}</option>
                          <option value="ADMIN">{ROLE_LABEL.ADMIN}</option>
                        </select>
                        <button type="submit" className={buttonSubtle}>
                          Save
                        </button>
                      </form>
                    </td>

                    <td className="px-4 py-3 align-top">
                      {account.isActive ? (
                        <Badge tone="success">Active</Badge>
                      ) : (
                        <Badge tone="neutral">Deactivated</Badge>
                      )}
                      {account.mustChangePassword && account.isActive ? (
                        <p className="mt-1 text-xs text-amber-700">
                          Must choose a new password
                        </p>
                      ) : null}
                      {account.historyCount > 0 ? (
                        <p className="mt-1 text-xs text-slate-500">
                          {account.historyCount} historical record
                          {account.historyCount === 1 ? "" : "s"} — kept permanently
                        </p>
                      ) : null}
                    </td>

                    <td className="px-4 py-3 align-top text-slate-700">
                      {account.lastLoginAt ? formatDate(account.lastLoginAt) : "Never"}
                    </td>

                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-wrap items-center gap-2">
                        <form action={setActiveAction}>
                          <input type="hidden" name="userId" value={account.id} />
                          <input
                            type="hidden"
                            name="isActive"
                            value={account.isActive ? "false" : "true"}
                          />
                          <button
                            type="submit"
                            className={buttonSubtle}
                            disabled={isSelf && account.isActive}
                            title={
                              isSelf && account.isActive
                                ? "You cannot deactivate your own account."
                                : undefined
                            }
                          >
                            {account.isActive ? "Deactivate" : "Reactivate"}
                          </button>
                        </form>

                        <button
                          type="button"
                          onClick={() =>
                            setResettingId((current) =>
                              current === account.id ? null : account.id,
                            )
                          }
                          className={buttonSubtle}
                        >
                          Set password
                        </button>
                      </div>

                      {resettingId === account.id ? (
                        <form
                          action={resetFormAction}
                          className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
                        >
                          <input type="hidden" name="userId" value={account.id} />
                          <input
                            type="password"
                            name="password"
                            autoComplete="new-password"
                            placeholder="New password"
                            required
                            className={inputClass}
                          />
                          <input
                            type="password"
                            name="confirmPassword"
                            autoComplete="new-password"
                            placeholder="Confirm password"
                            required
                            className={inputClass}
                          />
                          <button
                            type="submit"
                            className={buttonSecondary}
                            disabled={resetPending}
                          >
                            {resetPending ? "Saving…" : "Set password"}
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {staff.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-600">
            No staff accounts yet.
          </p>
        ) : null}

        <Result state={resetState} />
      </Card>

      {/* ---------------------------- system rows ---------------------------- */}
      {system.length > 0 ? (
        <Card className="p-6">
          <h2 className="text-sm font-bold text-slate-900">Historical system records</h2>
          <p className="mt-1 text-sm text-slate-600">
            These are not staff accounts. They exist so work recorded before sign-in
            existed still names something, and they can never sign in or approve
            anything.
          </p>
          <ul className="mt-3 space-y-1 text-sm text-slate-700">
            {system.map((account) => (
              <li key={account.id} className="flex flex-wrap items-center gap-2">
                <span dir="ltr" className="font-mono text-xs">
                  {account.email}
                </span>
                <Badge tone="neutral">Cannot sign in</Badge>
                {account.historyCount > 0 ? (
                  <span className="text-xs text-slate-500">
                    {account.historyCount} historical record
                    {account.historyCount === 1 ? "" : "s"}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
