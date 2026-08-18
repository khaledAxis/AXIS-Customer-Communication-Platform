# Microsoft 365 setup for SAFE TEST sending

How an AXIS administrator authorizes this application to send **one test email** from
`fahed@axis-gps.com` to `khaled-s@axis-gps.com`.

> **No mailbox password is ever involved.** This application authenticates as an
> *application*, not as a person. Never enter a mailbox password anywhere in this
> platform, and never share one with a developer.

---

## What you are creating

An **app registration** in Microsoft Entra ID with a client secret, plus a permission
grant that lets it send mail. The application then signs in with its own credentials
(client credentials flow) and calls
`POST https://graph.microsoft.com/v1.0/users/fahed@axis-gps.com/sendMail`.

`/me/sendMail` is deliberately **not** used: with app-only authentication there is no
signed-in "me", so the sender mailbox is always addressed explicitly.

---

## Step 1 — Create the app registration

1. Sign in to the **Microsoft Entra admin centre** (`entra.microsoft.com`) as an
   administrator.
2. **Identity → Applications → App registrations → New registration**.
3. Name: `AXIS Customer Communication Platform`.
4. Supported account types: **Accounts in this organizational directory only**
   (single tenant).
5. Leave *Redirect URI* empty — this application never signs a user in.
6. **Register**.

On the app's **Overview** page, copy:

| Portal label | Environment variable |
| --- | --- |
| **Application (client) ID** | `MICROSOFT_CLIENT_ID` |
| **Directory (tenant) ID** | `MICROSOFT_TENANT_ID` |

---

## Step 2 — Create a client secret

1. In the app → **Certificates & secrets → Client secrets → New client secret**.
2. Description: `AXIS platform`. Expiry: choose the shortest workable period
   (6–12 months) and diarise the renewal.
3. **Add**, then copy the **Value** column immediately into `MICROSOFT_CLIENT_SECRET`.
   It is shown once and cannot be retrieved later. Copy the *Value*, not the *Secret ID*.

For a long-lived production setup, prefer a **certificate** over a secret
(*Certificates & secrets → Certificates*). The adapter can be extended to certificate
credentials without changing anything else.

---

## Step 3 — Grant the sending permission

1. In the app → **API permissions → Add a permission → Microsoft Graph →
   Application permissions**.
2. Select **`Mail.Send`**.
3. **Add permissions**, then **Grant admin consent for AXIS**.

> ### ⚠️ Read this before granting
>
> **An application `Mail.Send` grant is tenant-wide by default.** It permits the
> application to send as **any mailbox in the organisation**, not just
> `fahed@axis-gps.com`. Granting it alone is broader than this application needs.
>
> Restrict it in Step 4. Until you do, the only thing preventing this application from
> sending as another mailbox is its own code — which is deliberately hard-coded to one
> sender, but should not be your sole control.

---

## Step 4 — Scope the permission to one mailbox (strongly recommended)

Use **Exchange Online RBAC for Applications** so the tenant itself limits the
application to the single sender mailbox.

In **Exchange Online PowerShell**, connected as an Exchange administrator:

```powershell
Connect-ExchangeOnline

# 1. A scope containing ONLY the sender mailbox.
New-ManagementScope -Name "AXIS-Sender-Only" `
  -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'fahed@axis-gps.com'"

# 2. Register the app registration as a service principal in Exchange.
#    Use the Application (client) ID and the Object ID of the ENTERPRISE APPLICATION
#    (Entra → Enterprise applications → your app → Overview → Object ID).
New-ServicePrincipal -AppId "<MICROSOFT_CLIENT_ID>" `
  -ObjectId "<ENTERPRISE_APP_OBJECT_ID>" `
  -DisplayName "AXIS Customer Communication Platform"

# 3. Allow sending ONLY within that scope.
New-ManagementRoleAssignment -App "<MICROSOFT_CLIENT_ID>" `
  -Role "Application Mail.Send" `
  -CustomResourceScope "AXIS-Sender-Only"
```

Verify:

```powershell
Get-ManagementRoleAssignment -App "<MICROSOFT_CLIENT_ID>" | Format-List Name,Role,CustomResourceScope
```

An older alternative is an **application access policy**
(`New-ApplicationAccessPolicy -AccessRight RestrictAccess`) scoped to a mail-enabled
security group containing only `fahed@axis-gps.com`. RBAC for Applications is the
current approach and is preferred.

**Do not** grant the application access to other AXIS mailboxes.

---

## Step 5 — Configure the application

Add the values to `.env.local` (git-ignored, never committed):

```
MICROSOFT_TENANT_ID="<Directory (tenant) ID>"
MICROSOFT_CLIENT_ID="<Application (client) ID>"
MICROSOFT_CLIENT_SECRET="<secret VALUE from step 2>"
MICROSOFT_SENDER_EMAIL="fahed@axis-gps.com"
SAFE_TEST_RECIPIENT="khaled-s@axis-gps.com"
```

Restart the application. The preview page reports **"Microsoft email provider is not
configured"** until all values are present and well-formed; a placeholder such as
`xxx` is treated as not configured.

---

## Step 6 — Send the first test

In the browser only — never from a script:

1. **Newsletters** → open a newsletter → **Preview**
2. Review the email exactly as rendered
3. **Approve Test Email** (tick the confirmation)
4. **Send Test Email**

One approval permits exactly one send. The message is marked `[AXIS TEST]`, a copy is
kept in the sender's **Sent Items**, and the result is recorded in the database.

---

## Permissions this application does NOT need

| Permission | Why not |
| --- | --- |
| `Mail.Read` / `Mail.ReadWrite` | It never reads mailboxes. Verify Sent Items by opening Outlook, not by granting read access. |
| `User.Read.All`, `Directory.Read.All` | It never reads directory data. |
| Delegated permissions | It never signs a user in. |

## Troubleshooting

| What you see | Likely cause |
| --- | --- |
| "Microsoft email provider is not configured" | A value is missing or is still a placeholder. |
| "Could not sign in to Microsoft…" | Wrong tenant ID, client ID, or an expired/mistyped secret (check you copied the *Value*). |
| "The application is not permitted to send as this mailbox" (403) | Admin consent not granted, or the RBAC scope excludes the sender. |
| "Microsoft could not find the sender mailbox" (404) | `MICROSOFT_SENDER_EMAIL` is wrong or the mailbox is unlicensed. |
| "Microsoft is throttling requests" (429) | Wait and retry; do not loop. |

## Security notes

- The client secret is a credential: treat it like a password, keep it only in
  `.env.local`, and rotate it before expiry.
- The application never logs or stores tokens, secrets, or `Authorization` headers.
- Application-level sender/recipient guards remain in force **regardless** of tenant
  configuration — they are independent of, not a substitute for, Step 4.
