# Email sending capsule

A portable, dependency-free email sender for Node 18+. Supports Amazon SES, Resend, and a sandbox mode that sends nothing.

## Use it in another platform
1. Copy `email-sender.mjs` into the project.
2. Set the environment variables below.
3. Call `createEmailSender()` and `send()`.

```js
import { createEmailSender } from './email-sender.mjs'
const mailer = createEmailSender({ isSuppressed: async (email) => false })
await mailer.send({ to: 'user@example.com', subject: 'Your code', text: 'Code: 123456' })
```

## Environment
| Variable | Used by | Notes |
|---|---|---|
| `EMAIL_PROVIDER` | all | `sandbox` (default), `ses`, or `resend` |
| `EMAIL_FROM` | ses, resend | A verified sender, e.g. `no-reply@notifications.sybnb.app` |
| `AWS_REGION` | ses | e.g. `us-east-2` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | ses | A key with only `ses:SendEmail` |
| `RESEND_API_KEY` | resend | Keep out of git |

## Before going live
- **SES:** verify the sending domain (DKIM CNAMEs at your DNS provider), then request production access. Until then SES only sends to verified addresses.
- **Resend:** keep the invoice paid and the domain verified.
- Never log message bodies. They can contain one-time codes.

## Security
Credentials are never logged or included in errors. Rotate any key that was pasted in chat.
