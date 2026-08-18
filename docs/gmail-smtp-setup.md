# Gmail SMTP setup for SAFE TEST sending

How to let this application send **one test email** from `axisgpscana@gmail.com` to
`khaled-s@axis-gps.com`.

> **Never use the normal Google account password.** This application authenticates with
> a Google **App Password** — a 16-character credential scoped to one application that
> can be revoked at any time without changing the account password. Never share the
> account password with a developer or paste it into this project.

---

## Step 1 — Turn on 2-Step Verification

App Passwords only exist once 2-Step Verification is enabled.

1. Sign in as `axisgpscana@gmail.com`.
2. Go to **myaccount.google.com → Security**.
3. Under *How you sign in to Google*, enable **2-Step Verification**.

## Step 2 — Create an App Password

1. Go to **myaccount.google.com/apppasswords** (or Security → 2-Step Verification →
   App passwords).
2. Give it a name such as `AXIS Communication Platform`.
3. **Create**, then copy the 16-character value shown. It is displayed once.

Google shows it as four groups of four (`abcd efgh ijkl mnop`). Spaces are optional —
the application strips them.

## Step 3 — Configure the application

Add to `.env.local` (git-ignored, never committed):

```
EMAIL_PROVIDER="gmail_smtp"
GMAIL_SMTP_USER="axisgpscana@gmail.com"
GMAIL_APP_PASSWORD="<the 16-character App Password>"
SAFE_TEST_SENDER="axisgpscana@gmail.com"
SAFE_TEST_RECIPIENT="khaled-s@axis-gps.com"
```

Restart the application. The preview page reports **"Gmail test email provider is not
configured"** with a specific reason until every value is present and well-formed.

`GMAIL_SMTP_USER` **must** equal `SAFE_TEST_SENDER`: Gmail sends as the authenticated
account, so a mismatch would silently send from a different mailbox. The application
refuses to send in that case.

## Step 4 — Send the first test

In the browser only — never from a script:

1. **Newsletters** → open a newsletter → **Preview**
2. Review the email exactly as rendered
3. Tick the confirmation and press **Approve Test Email**
4. Press **Send Test Email**

One approval permits exactly one send. The message is marked `[AXIS TEST]`, and Gmail
keeps a copy in the sender's **Sent** folder automatically.

---

## Connection details used

| Setting | Value |
| --- | --- |
| Host | `smtp.gmail.com` |
| Port | `465` |
| Encryption | Implicit TLS (`secure: true`) |
| Auth | App Password |

## Troubleshooting

| What you see | Likely cause |
| --- | --- |
| "Gmail test email provider is not configured" | A value is missing, or the App Password is not 16 characters. The panel lists the exact reason. |
| "Gmail rejected the sign-in" | The App Password was revoked, mistyped, or 2-Step Verification was turned off. Create a new one. |
| "Gmail rejected the sender or recipient address" | The account cannot send as that address. |
| "Gmail is temporarily unavailable or rate-limiting" | Gmail's per-account send limits. Wait and retry — never loop. |
| "The connection to Gmail failed before it confirmed the result" | Uncertain outcome. **Check the Sent folder before approving another test** — the message may already have gone. |

## Limits to be aware of

Gmail imposes per-account daily send limits (a few hundred messages for a consumer
account). That is ample for one-off test sends and is **not** a route to production
newsletters — bulk sending needs a proper provider (ADR-0004) with SPF/DKIM/DMARC
aligned to the AXIS domain.

## Security notes

- The App Password is a credential: keep it only in `.env.local` and revoke it from
  the Google account page if it is ever exposed.
- The application never logs, stores, or returns the password, and it never appears in
  an error message.
- Application-level sender/recipient guards are hard-coded constants; environment
  variables are cross-checked against them and cannot redirect a test email.
