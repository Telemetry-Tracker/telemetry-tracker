# Alert webhooks

Project-scoped HTTPS destinations receive a POST when Telemetry Tracker fires an alert
(`ERROR_SPIKE`, `QUOTA_NEAR`, `QUOTA_EXCEEDED`, `ALERT_RULE`) via `fireProjectAlert`.
Configurable rules and destination binding: [ALERT-RULES.md](./ALERT-RULES.md).

Configure destinations under **Dashboard → Alerts → Delivery** (owners/editors).
Up to **5** destinations per project (shared across generic HTTPS webhooks and chat
channels). Choose a channel when adding:

| Provider | Payload | Notes |
|----------|---------|--------|
| **GENERIC** (`#225`) | Signed `alert.fired` JSON below | Optional HMAC signing secret |
| **SLACK** (`#223`) | Slack Incoming Webhook (`text` + Block Kit) | URL must be `hooks.slack.com/services/…` |
| **DISCORD** (`#224`) | Discord webhook embeds | URL must be `discord.com` / `discordapp.com` `/api/webhooks/{id}/{token}` |
| **MICROSOFT_TEAMS** / **TELEGRAM** (`#500`) | Teams MessageCard / Bot `sendMessage` | Teams: legacy Office 365 MessageCard only (see below). Telegram: `api.telegram.org/bot…/sendMessage` + `chatId` |

- URLs must be `https:` and must not target loopback, private, or link-local hosts
  (create/update string checks).
- At delivery time the worker **resolves DNS**, rejects private/loopback/link-local
  **IPv4 and IPv6** answers, and **pins the HTTPS connect** to a validated address
  (custom `lookup` + TLS SNI / `Host` for the original hostname) so a rebinding race
  cannot retarget the socket after validation.
- Delivery POSTs do not follow redirects (`https.request` does not auto-follow).
- Chat providers skip Telemetry HMAC signing (recipients ignore custom signature headers).

## Generic payload

```json
{
  "version": 1,
  "event": "alert.fired",
  "deliveryId": "uuid",
  "firedAt": "2026-07-17T10:00:00.000Z",
  "projectId": "…",
  "rule": "ERROR_SPIKE",
  "title": "Error spike detected",
  "body": "42 errors in the last 15 minutes (threshold 25).",
  "href": "https://your-dashboard.example/dashboard/errors",
  "dedupeKey": "alert:error_spike:…:15:…"
}
```

`href` is absolutized when `DASHBOARD_ORIGIN` (or equivalent) is configured on the API;
otherwise it may be a path like `/dashboard/errors`.

`deliveryId` is the durable `AlertWebhookDelivery.id` (stable across retries).

## Slack payload

Slack destinations POST JSON shaped for [Incoming Webhooks](https://api.slack.com/messaging/webhooks)
(`text` fallback plus a `section` block with mrkdwn). Create the URL in Slack
(Incoming Webhooks app or workflow) and paste it on Alerts → Delivery → Slack.

## Discord payload

Discord destinations POST JSON with a single embed (`title`, `description`, rule field,
optional `url` back to the dashboard). Create a channel webhook in Discord
(Channel settings → Integrations → Webhooks) and paste it on Alerts → Delivery → Discord.

## Microsoft Teams payload

Teams destinations always POST an Office 365 [MessageCard](https://learn.microsoft.com/en-us/outlook/actionable-messages/message-card-reference)
(`@type: MessageCard`, `title`, `text`, optional OpenUri action). There is no Adaptive Card body.

The URL check accepts `outlook.office.com`, `webhook.office.com`, `*.webhook.office.com`
(including `/webhookb2/…`), `*.logic.azure.com`, and `*.environment.api.powerplatform.com`.
Tests cover that host list and the MessageCard JSON shape. They do not POST to Microsoft.

Power Automate and Teams Workflows HTTP URLs pass the host check only. This repository does
not verify that those endpoints accept a MessageCard. Do not treat Power Automate as a
supported destination. The dashboard placeholder is still a `webhook.office.com/webhookb2/` URL.

## Telegram payload

Telegram destinations POST Bot API [`sendMessage`](https://core.telegram.org/bots/api#sendmessage)
JSON (`chat_id`, HTML `text`). Store the URL as
`https://api.telegram.org/bot<token>/sendMessage` and set the chat id in the form
(numeric id or `@username`). The bot must be able to message that chat.

## Headers

| Header | Value |
|--------|--------|
| `Content-Type` | `application/json` |
| `User-Agent` | `TelemetryTracker-Webhooks/1.0` |
| `X-Telemetry-Event` | `alert.fired` |
| `X-Telemetry-Delivery` | Same UUID as `deliveryId` |
| `X-Telemetry-Signature` | `sha256=<hex>` when a signing secret is set (generic destinations) |

Verify signatures with HMAC-SHA256 over the **raw request body** using the secret
shown once when the webhook is created.

## Delivery semantics

- Fired only after a new `AlertEvent` row is inserted (dedupe key unique per project).
- `fireProjectAlert` **awaits** inserting `PENDING` `AlertWebhookDelivery` rows for each
  enabled webhook, then returns (survives API process restart).
- Run the worker (same Postgres claim/lease pattern as brief generation):

  ```bash
  pnpm --filter api alert-webhook-worker          # poll loop
  pnpm --filter api alert-webhook-worker -- --once  # single delivery
  ```

  Production (Railway): long-running service `alert-webhook-worker` with start
  command `node dist/jobs/run-alert-webhook-worker.js` — see
  [RAILWAY.md → Alert webhook worker](./RAILWAY.md#alert-webhook-worker).

  Env: `ALERT_WEBHOOK_WORKER_POLL_MS` (default `1000`),
  `ALERT_WEBHOOK_WORKER_LEASE_MS` (default `30000`, minimum =
  DNS timeout `5000` + HTTPS POST timeout `8000` + `5000` margin).

- Worker flow: claim (`FOR UPDATE SKIP LOCKED` + lease) → DNS/IP validate + pin
  (DNS bounded by `WEBHOOK_DNS_TIMEOUT_MS`) →
  POST → record outcome → retry with short backoff (`FAILED` + `next_attempt_at`) or
  terminal `DEAD` after **2** attempts.
- Operators can browse recent rows under **Alerts → Delivery** (read access for
  project members; same auth as alert history). Optionally filter via
  `GET /api/project/webhook-deliveries?webhookId=…`.
- Use **Test** on the Alerts page to POST a sample payload immediately (not queued);
  a failed test is logged as `FAILED` (single-shot).

## Related

- Parent notifications vision: GitHub #492 (v1.14.x — shipped; parent may remain open as living roadmap)
- Generic HTTPS webhooks: #225
- Slack / Discord / Telegram / Teams destinations: #223, #224, #500 (shipped)
- In-product Notification Center: #508
- Configurable alert rules: #493 / [ALERT-RULES.md](./ALERT-RULES.md) (v1.15.x — shipped; rules bind opaque destination ids; this doc owns channel delivery)
