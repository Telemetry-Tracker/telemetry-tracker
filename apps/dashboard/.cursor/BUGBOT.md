# Dashboard (`apps/dashboard`) — Bugbot rules

Next.js App Router. All data access goes through the Fastify API — **no direct Postgres** in the dashboard.

## Server vs client boundary

- Files with `"use client"` must **not** import `next/headers`, `next/cookies`, or server-only fetch helpers.
- Shared modules in `lib/` imported by client components must be client-safe. Server fetch/cache logic belongs in `*-server.ts` (pattern: `alert-settings-server.ts` vs `alert-settings.ts`).
- Server Actions (`app/**/actions.ts`) may use cookies/headers; keep secrets and API base URLs server-side only.

## API integration

- Authenticated fetches must forward session cookie or bearer token consistently with existing `lib/api*.ts` helpers.
- Project/org context headers (`X-Project-Id`, `X-Organization-Id`) must match active shell selection — do not hardcode project ids.
- Error handling: user-visible toasts vs silent failures should match surrounding settings pages.

## Notifications UI

- Bell ([DashboardNotifications.tsx](../app/components/dashboard/shell/DashboardNotifications.tsx)) renders items from API — type-specific icons/links must handle `alert`, `quota`, `billing`, `issue`, `team`.
- Notification preferences UI must stay in sync with API categories (`issues`, `billing`, `team`, `alerts`) — adding a category requires both sides.
- Alerts settings ([AlertsClient.tsx](../app/dashboard/alerts/AlertsClient.tsx)): UI promises (e.g. "Exceeded alerts always fire") must match API behavior in `quota-alert.ts`.

## Settings and billing

- Billing portal and Stripe actions: only OWNER/EDITOR capabilities per [docs/RBAC.md](../../docs/RBAC.md).
- Usage cards (`OrganizationUsageCard`) rely on `usageQuota` from session context — `nearQuota`/`quotaExceeded` flags must reflect API-computed thresholds, not client-side math on stale data.
- **Dashboard preferences persistence** (`/api/meta/dashboard-preferences`, settings page): storing defaults without yet applying them to list pages, bootstrap, or analytics is intentional until a follow-up wires consumption — do not flag as incomplete persistence work.

## Accessibility and UX

- Interactive controls need labels; destructive actions need confirmation where the rest of settings does.
- Theme/light-dark: use existing CSS variables / `ThemeProvider` tokens — avoid hardcoded colors that break light mode.

## Tests

- Component tests live in `apps/dashboard/__tests__/`. Meaningful behavior changes should extend tests there or API unit tests when logic moves server-side.
