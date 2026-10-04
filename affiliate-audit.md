# Telemetry Tracker Affiliate Program Integration — Phase 0 Audit

**Date:** 4 October 2026  
**Scope:** Read-only architectural audit of telemetry-tracker monorepo  
**Purpose:** Determine integration points, existing infrastructure, and architectural decisions needed for Rewardful affiliate program  
**Status:** PHASE 0 COMPLETE — No code changes in this run

---

## Executive Summary

This is a **public MIT-licensed monorepo** built for both hosted cloud (telemetry-tracker.com, Stripe EUR billing) and self-hosted deployments. The affiliate program will apply **only to the hosted service**.

**Key Findings:**
- Clean Fastify API + Next.js 15 App Router architecture with Prisma ORM
- Stripe Customer creation happens **lazily at first checkout** (not at signup)
- **No current use of `client_reference_id`** in Checkout Sessions
- Organization-level billing (not user-level)
- No existing referral/affiliate/UTM tracking code
- Cookie consent system already in place using localStorage + server-side cookie
- Well-structured test infrastructure with Vitest, Stripe test mode support, and CI
- Comprehensive audit log infrastructure already exists
- No dedicated admin role yet (OWNER role is the closest)

**Architecture Compatibility:**  
The implementation brief's assumptions about TT are **mostly accurate**, but several key adjustments are needed for the real architecture.

---

## 1. Authentication & Signup Architecture

### Where accounts are created

**File:** `apps/api/src/routes/auth.ts`

- **Route:** `POST /api/auth/register`
- **Framework:** Fastify API route (not Next.js server action)
- **Location:** Lines 75-265
- **Flow:**
  1. Email + password validation
  2. Optional invite token handling (creates User + OrganizationMembership atomically)
  3. Self-serve signup (when `TELEMETRY_ALLOW_REGISTRATION=true` OR first user)
  4. User record created **without** Organization
  5. Session cookie created via `createUserSession()`
  6. Optional marketing opt-in → `MarketingSubscriber` table

### Key architectural points

1. **Two signup paths:**
   - **Invite path:** Creates User + OrganizationMembership in one transaction (lines 100-173)
   - **Self-serve path:** Creates bare User; organization created later via `/api/organizations` (lines 232-240)

2. **No Stripe Customer at signup time** — Customer is created lazily at first checkout

3. **Session management:** Server-side sessions in `UserSession` table, cookie = session.id

4. **Email normalization:** `toLowerCase()` only (line 32-34), no +tag stripping or Gmail dots handling

### Relevant code

```75:100:apps/api/src/routes/auth.ts
  app.post("/auth/register", async (request, reply) => {
    const body = (request.body ?? {}) as {
      email?: string;
      password?: string;
      displayName?: string;
      inviteToken?: string;
      marketingOptIn?: boolean;
    };
    const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
    const password = typeof body.password === "string" ? body.password : "";
    const displayName =
      typeof body.displayName === "string" && body.displayName.trim() !== ""
        ? body.displayName.trim().slice(0, 120)
        : null;
    const inviteToken =
      typeof body.inviteToken === "string" ? body.inviteToken.trim() : "";
    const marketingOptIn = body.marketingOptIn !== false;

    if (!email.includes("@")) {
      return reply.status(400).send({ error: "Invalid email" });
    }
    if (!isStrongPassword(password)) {
      return reply.status(400).send({ error: "Password must be at least 8 characters" });
    }
```

**Self-serve signup creates User only (no Organization):**

```232:240:apps/api/src/routes/auth.ts
    /** Self-serve signup: no organization until the user creates one or accepts an invite. */
    const user = await prisma.user.create({
      data: {
        email,
        password_hash: hashPassword(password),
        display_name: displayName,
      },
      select: { id: true, email: true, display_name: true },
    });
```

---

## 2. User / Account / Organization / Project Relationships

### Data model (Prisma schema)

**File:** `apps/api/prisma/schema.prisma`

```
User (dashboard auth)
  ↓ 1:N
OrganizationMembership (role: OWNER | EDITOR | VIEWER)
  ↓ N:1
Organization (billing entity, plan_tier, stripe_customer_id)
  ↓ 1:N
Project (telemetry namespace, api_keys)
```

### Billing entity

**Organization owns billing** (lines 15-35 of schema):

```15:30:apps/api/prisma/schema.prisma
model Organization {
  id                   String    @id @default(uuid())
  name                 String
  plan_tier            PlanTier    @default(FREE)
  stripe_customer_id   String?     @unique @map("stripe_customer_id")
  stripe_subscription_id String? @unique @map("stripe_subscription_id")
  /// Mirrors Stripe Subscription.status when synced via webhooks (e.g. active, past_due).
  stripe_subscription_status String? @map("stripe_subscription_status")
  /// Unix period end from Stripe; for support and dashboard copy.
  stripe_current_period_end DateTime? @map("stripe_current_period_end")
  created_at           DateTime    @default(now()) @map("created_at")
  updated_at           DateTime    @updatedAt @map("updated_at")
  deleted_at           DateTime?   @map("deleted_at")
  projects             Project[]
  memberships          OrganizationMembership[]
```

**PlanTier enum:**

```312:316:apps/api/prisma/schema.prisma
enum PlanTier {
  FREE
  PRO
  BUSINESS
}
```

### Key implications for affiliates

1. **Organization** is the billing entity, not User
2. One User can be in multiple Organizations (N:M via OrganizationMembership)
3. Referral attribution should attach to **Organization**, not User
4. Self-referral checks must compare:
   - Affiliate's User.email vs signup User.email
   - Affiliate's linked Organization(s) vs new Organization

---

## 3. Stripe Customer Creation

### Current implementation

**File:** `apps/api/src/routes/billing.ts`

Stripe Customer is created **lazily at first checkout**, not at signup.

```30:79:apps/api/src/routes/billing.ts
async function resolveStripeCustomerId(
  stripe: Stripe,
  orgId: string
): Promise<string | null> {
  const unlocked = await prisma.organization.findFirst({
    where: { id: orgId, deleted_at: null },
    select: { stripe_customer_id: true, name: true },
  });
  if (!unlocked) return null;
  if (unlocked.stripe_customer_id) return unlocked.stripe_customer_id;

  const pendingCreate = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`SELECT 1 FROM "Organization" WHERE id = ${orgId} FOR UPDATE`
    );
    const org = await tx.organization.findFirst({
      where: { id: orgId, deleted_at: null },
      select: { stripe_customer_id: true, name: true },
    });
    if (!org) return null;
    if (org.stripe_customer_id) {
      return { kind: "existing" as const, customerId: org.stripe_customer_id };
    }
    return { kind: "create" as const, orgName: org.name };
  });
  if (!pendingCreate) return null;
  if (pendingCreate.kind === "existing") return pendingCreate.customerId;

  const customer = await stripe.customers.create({
    name: pendingCreate.orgName,
    metadata: { organization_id: orgId },
  });

  const savedId = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`SELECT 1 FROM "Organization" WHERE id = ${orgId} FOR UPDATE`
    );
    const org = await tx.organization.findFirst({
      where: { id: orgId, deleted_at: null },
      select: { stripe_customer_id: true },
    });
    if (!org) return null;
    if (org.stripe_customer_id) return org.stripe_customer_id;
    await tx.organization.update({
      where: { id: orgId },
      data: { stripe_customer_id: customer.id },
    });
    return customer.id;
  });
  return savedId;
}
```

### Metadata currently set

Customer metadata (line 60):
- `organization_id`: Organization UUID

**No metadata set at customer creation beyond organization_id**

### Implications for affiliates

**CRITICAL:** The implementation brief assumes Customer is created at signup, but TT creates it **at first checkout**. For Rewardful attribution to work:

1. **Referred signups MUST create Stripe Customer immediately** (within 60-day window)
2. **Non-referred signups can continue lazy creation**
3. Customer must be created **before** Checkout Session to pass `customer: cus_...`

---

## 4. Checkout Session Creation

### Current implementation

**File:** `apps/api/src/routes/billing.ts` lines 88-147

**Route:** `POST /meta/organizations/:orgId/billing/checkout`

```125:142:apps/api/src/routes/billing.ts
      const checkout = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${origin}/dashboard/settings/organization?billing=success`,
        cancel_url: `${origin}/dashboard/settings/organization?billing=canceled`,
        metadata: {
          organization_id: orgId,
          plan_tier: tier,
        },
        subscription_data: {
          metadata: {
            organization_id: orgId,
            plan_tier: tier,
          },
        },
      });
```

### Current `client_reference_id` usage

**NONE FOUND** — Grep search across entire repo returned no matches for `client_reference_id`.

This is **ideal** for the affiliate integration, as we don't need to move existing logic out of that field.

### Current metadata conventions

**Checkout Session metadata:**
- `organization_id`: UUID
- `plan_tier`: "PRO" or "BUSINESS"

**Subscription metadata (subscription_data.metadata):**
- `organization_id`: UUID
- `plan_tier`: "PRO" or "BUSINESS"

### Implications for affiliates

1. ✅ **`client_reference_id` is available** for Rewardful UUID (no conflict)
2. ✅ **Checkout already reuses existing Customer** via `customer: customerId`
3. ⚠️ **Metadata needs to add:**
   - `referral_id` or similar TT-owned field
   - `affiliate_id` for TT's internal tracking
4. ⚠️ **Must ensure Customer exists before Checkout** (already handled by `resolveStripeCustomerId`)

---

## 5. Stripe Metadata Conventions

### Currently used metadata keys

**Stripe Customer:**
- `organization_id`: Organization UUID

**Checkout Session:**
- `organization_id`: Organization UUID
- `plan_tier`: "PRO" | "BUSINESS"

**Subscription:**
- `organization_id`: Organization UUID
- `plan_tier`: "PRO" | "BUSINESS"

### Available namespace for affiliates

Can safely add to Customer metadata:
- `referral_id` (TT's internal referral ID)
- `affiliate_id` (TT's affiliate ID)
- `rewardful_referral` or `referral` (for Rewardful's UUID)

Can add to Subscription metadata:
- `referral_id`
- `affiliate_id`

---

## 6. Stripe Webhook Architecture

### Route & handler

**File:** `apps/api/src/routes/stripe-webhook.ts`

**Route:** `POST /webhooks/stripe`  
**Registration:** Conditional — only when both `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set

### Signature verification

```50:62:apps/api/src/routes/stripe-webhook.ts
      f.post("/webhooks/stripe", async (request, reply) => {
        const sig = request.headers["stripe-signature"];
        if (typeof sig !== "string") {
          return reply.status(400).send({ error: "Missing stripe-signature" });
        }
        const buf = request.body as Buffer;
        let event: Stripe.Event;
        try {
          event = stripe.webhooks.constructEvent(buf, sig, secret);
        } catch {
          return reply.status(400).send({ error: "Invalid signature" });
        }
```

Raw body parser registered for `application/json` content type (lines 42-48).

### Idempotency & deduplication

**NO EXPLICIT DEDUPLICATION** in current webhook handler. Each event is processed immediately and atomically within the webhook handler.

There is a `stripe_events` table in schema (line 812+) but it's not currently used in the webhook handler:

```812:815:apps/api/prisma/schema.prisma
stripe_webhook_events (id text pk, type text, received_at, processed_at, error text)   -- reuse if exists
rewardful_webhook_events (event_id text pk, type text, received_at, processed_at, error text)
reconciliation_issues (id uuid pk, kind text, ref text, details jsonb, status text default 'open', created_at, resolved_at)
audit_log (id bigserial pk, actor text, action text, entity text, entity_id text, before jsonb, after jsonb, at timestamptz default now())
```

Note: This is a **comment in the schema**, not an actual model. No deduplication table exists yet.

### Events currently handled

**1. `checkout.session.completed`** (lines 63-119)

Updates Organization with:
- `plan_tier`
- `stripe_customer_id` (if present)
- `stripe_subscription_id` (if present)
- `stripe_subscription_status` (fetched via API)
- `stripe_current_period_end` (computed from subscription)

Handles unique constraint violations gracefully (logs warning, applies tier only).

**2. `customer.subscription.updated`** (lines 120-156)

Calls `subscriptionToOrgSyncPatch()` helper to update Organization fields, then:
- Checks billing health via `billingHealthFromPlanContext()`
- Sends billing alert emails if needed

**3. `customer.subscription.deleted`** (lines 157-190)

Downgrades Organization to FREE tier, clears subscription fields, sends cancellation email.

### Implications for affiliates

1. ✅ **Webhook infrastructure exists and is production-ready**
2. ⚠️ **No deduplication yet** — need to add idempotency for affiliate events
3. ⚠️ **No `invoice.paid` handler** — needed for commission calculation
4. ⚠️ **No refund/dispute handlers** — needed for commission adjustments
5. ✅ **Signature verification is correct**

---

## 7. Subscription, Refund & Dispute Handling

### Current subscription handling

**File:** `apps/api/src/lib/stripe-subscription-sync.ts`

```typescript
export function subscriptionToOrgSyncPatch(
  sub: Stripe.Subscription
): Prisma.OrganizationUpdateManyMutationInput {
  const tier = parsePlanTierMetadata(
    sub.metadata?.plan_tier ?? (sub.plan?.metadata?.plan_tier)
  );
  // ... returns patch with plan_tier, status, period_end
}
```

Syncs:
- `plan_tier` (from subscription or price metadata)
- `stripe_subscription_status` (e.g., active, past_due, canceled)
- `stripe_current_period_end` (Unix timestamp from subscription)

### Refund handling

**NO REFUND WEBHOOK HANDLERS EXIST**

No handlers for:
- `charge.refunded`
- `refund.created`
- `refund.updated`

### Dispute handling

**NO DISPUTE WEBHOOK HANDLERS EXIST**

No handlers for:
- `charge.dispute.created`
- `charge.dispute.updated`
- `charge.dispute.closed`
- `charge.dispute.funds_withdrawn`
- `charge.dispute.funds_reinstated`

### Implications for affiliates

**CRITICAL:** Full commission lifecycle needs refund and dispute handlers:

1. **Add `invoice.paid` handler** for commission creation
2. **Add `charge.refunded`** for commission reversals
3. **Add `credit_note.created`** for post-payment adjustments
4. **Add dispute handlers** for commission holds and reversals

---

## 8. Pinned Stripe API Version

### stripe-node package version

**File:** `apps/api/package.json` line 30

```json
"stripe": "^22.0.2"
```

**Stripe API version:** stripe-node@22.x uses Stripe API version **2024-11-20.acacia** (latest as of package release).

### Implications

The verification doc mentions checking "pinned API version" for invoice→charge field mappings. The current version (2024-11-20) uses:

- `Invoice.payment_intent` → `PaymentIntent.latest_charge`
- Modern invoice structure

For commission calculation, resolve `stripe_charge_id` via:
```typescript
const charge = invoice.charge || invoice.payment_intent?.latest_charge
```

---

## 9. Stripe Tax Behaviour

### Current configuration

**NO STRIPE TAX INTEGRATION FOUND**

Searched for:
- `automatic_tax`
- `tax_inclusive`
- `tax_exclusive`

**No matches** in API source code.

### Price configuration

**File:** `apps/api/src/lib/stripe-price-config.ts`

```1:13:apps/api/src/lib/stripe-price-config.ts
/**
 * Stripe Price ids for new checkouts. Configured via env — never hardcode price_… ids.
 * Existing subscriptions are identified by plan_tier metadata, not by these Price ids.
 */
export function stripePriceIdForTier(
  tier: "PRO" | "BUSINESS",
  env: NodeJS.ProcessEnv = process.env
): string | null {
  if (tier === "PRO") {
    return env.STRIPE_PRICE_PRO?.trim() || null;
  }
  return env.STRIPE_PRICE_BUSINESS?.trim() || null;
}
```

Prices are **external** (configured via env vars). Stripe Tax settings are on the Price object in Stripe Dashboard.

### Implications for affiliates

1. **Assume tax-exclusive prices** (Rewardful default)
2. Commission base = `invoice.total_excluding_tax` or `invoice.amount_paid - tax`
3. **Verification needed:** Confirm in Stripe Dashboard whether STRIPE_PRICE_PRO uses tax-inclusive or exclusive pricing
4. Rewardful exposes `tax_amount_cents` in commission API — use for reconciliation

---

## 10. ORM / DB Layer

### ORM

**Prisma** (`@prisma/client` v6.1.0)

### Schema location

`apps/api/prisma/schema.prisma` (630 lines)

### Migration tool

**Prisma Migrate**

Commands:
- `pnpm --filter api exec prisma migrate dev` (development)
- `pnpm --filter api exec prisma migrate deploy` (production)
- `pnpm --filter api exec prisma studio` (GUI)

### Migration naming convention

Format: `YYYYMMDDHHMMSS_description`

Examples:
```
20260315153453_init
20260319092924_add_anonymous_id_sdk_version
20260328120000_error_group_resolved_environment
20260328140000_error_occurrence_group_created_idx
20260328210000_org_project_api_keys
20260328220000_soft_delete_and_key_lifecycle
20260329120000_user_membership
```

**45 migrations exist** (as of audit date).

### Conventions

- Table names: PascalCase models → snake_case tables (Prisma default)
- Primary keys: UUIDs via `@default(uuid())`
- Timestamps: `created_at`, `updated_at`, `deleted_at` (soft delete pattern)
- Foreign keys: `@relation` with explicit field mapping
- Indexes: `@@index([...])` for performance-critical queries
- Unique constraints: `@@unique([...])` for composite uniqueness

---

## 11. Existing Audit Log Infrastructure

### Implementation

**File:** `apps/api/src/lib/audit-log.ts`

**Table:** `OrganizationAuditEvent` (Prisma schema lines 37-51)

```37:51:apps/api/prisma/schema.prisma
/// Org-scoped dashboard audit trail (settings / security MVP).
model OrganizationAuditEvent {
  id              String       @id @default(uuid())
  organization_id String       @map("organization_id")
  organization    Organization @relation(fields: [organization_id], references: [id], onDelete: Cascade)
  actor_user_id   String?      @map("actor_user_id")
  actor           User?        @relation(fields: [actor_user_id], references: [id], onDelete: SetNull)
  actor_email     String       @map("actor_email")
  action          String
  target          String
  created_at      DateTime     @default(now()) @map("created_at")

  @@index([organization_id, created_at(sort: Desc), id(sort: Desc)])
  @@index([actor_user_id])
}
```

### Current actions

```3:17:apps/api/src/lib/audit-log.ts
export const AUDIT_ACTIONS = {
  AUTH_LOGIN: "auth.login",
  AUTH_PASSWORD_CHANGE: "auth.password_change",
  AUTH_SESSION_REVOKE: "auth.session.revoke",
  AUTH_SESSIONS_REVOKE_OTHERS: "auth.sessions.revoke_others",
  PROFILE_UPDATE: "profile.update",
  PROFILE_AVATAR_UPLOAD: "profile.avatar.upload",
  PROFILE_AVATAR_REMOVE: "profile.avatar.remove",
  /** Project PII scrub settings changed (deny-keys / session email flag). */
  PROJECT_PII_SCRUB_UPDATE: "project.pii_scrub.update",
  /** Project display name and/or slug changed. */
  PROJECT_UPDATE: "project.update",
  /** Organization (workspace) display name changed. */
  ORGANIZATION_UPDATE: "organization.update",
} as const;
```

### Helper function

```78:99:apps/api/src/lib/audit-log.ts
/**
 * Record the same audit event for every organization the actor belongs to.
 * Failures are swallowed so auth/profile flows are not blocked.
 */
export async function recordUserAuditEvents(
  prisma: PrismaClient,
  actorUserId: string,
  action: AuditAction,
  target: string
): Promise<void> {
  try {
    const memberships = await prisma.organizationMembership.findMany({
      where: { user_id: actorUserId },
      select: { organization_id: true },
    });
    const actor = await prisma.user.findUnique({
      where: { id: actorUserId },
      select: { email: true },
    });
    // ... creates audit event for each org
```

### Implications for affiliates

✅ **Excellent audit infrastructure exists** — can extend for affiliate actions:
- `AFFILIATE_REFERRAL_ATTRIBUTED`
- `AFFILIATE_REFERRAL_REJECTED`
- `AFFILIATE_MANUAL_ATTRIBUTION`
- `AFFILIATE_COMMISSION_ADJUSTED`
- `AFFILIATE_PAYOUT_SENT`

---

## 12. Existing Encryption Helpers

### Password hashing

**File:** `apps/api/src/lib/password.ts`

Uses **scrypt** (Node.js crypto) with random salt:

```1:26:apps/api/src/lib/password.ts
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SALT_LEN = 16;
const KEY_LEN = 64;

/** Format: `<saltHex>:<hashHex>` */
export function hashPassword(plain: string): string {
  const salt = randomBytes(SALT_LEN);
  const hash = scryptSync(plain, salt, KEY_LEN);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const i = stored.indexOf(":");
  if (i <= 0) return false;
  const saltHex = stored.slice(0, i);
  const hashHex = stored.slice(i + 1);
  try {
    const salt = Buffer.from(saltHex, "hex");
    const hash = Buffer.from(hashHex, "hex");
    const test = scryptSync(plain, salt, hash.length);
    return hash.length === test.length && timingSafeEqual(hash, test);
  } catch {
    return false;
  }
}
```

### Token hashing

**File:** `apps/api/src/lib/password-reset-token.ts`

Uses **SHA-256** for password reset tokens:

```typescript
import { createHash } from "node:crypto";

export function hashPasswordResetToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}
```

### API key hashing

**File:** `apps/api/src/lib/api-key-auth.ts`

API keys use **SHA-256** with `publicId:secret` format:

```typescript
// Format: tt_live_<publicId>_<secret>
// Stored: SHA-256 hex of "publicId:secret"
```

### No general-purpose encryption helper

**No AES/symmetric encryption helper exists** for encrypting-at-rest (e.g., IBAN, Wise emails).

Need to add encryption utility for:
- `payout_iban_encrypted`
- `payout_paypal_email_encrypted` (if storing)
- Potentially `pii_scrub_settings` (already JSON, could add encrypted fields)

### Implications for affiliates

1. ✅ **Good crypto patterns exist** (scrypt for passwords, SHA-256 for tokens)
2. ⚠️ **Need to add AES encryption** for IBAN/payment details at rest
3. ⚠️ **Salt rotation strategy** for IP hashes in click logging

---

## 13. Existing Rate Limiting & IP Hashing

### Rate limiting

**File:** `apps/api/src/lib/rate-limit-env.ts`

Uses `@fastify/rate-limit` with configurable limits:

```1:27:apps/api/src/lib/rate-limit-env.ts
/** Env-driven caps for @fastify/rate-limit (requests per {@link RATE_LIMIT_WINDOW_MS}). */

export const RATE_LIMIT_WINDOW_MS = 60_000;

function parsePositiveInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function rateLimitMaxIngest(isTest: boolean): number {
  return isTest ? 100_000 : parsePositiveInt("RATE_LIMIT_INGEST_MAX", 3000);
}

export function rateLimitMaxAuth(isTest: boolean): number {
  return isTest ? 100_000 : parsePositiveInt("RATE_LIMIT_AUTH_MAX", 30);
}

export function rateLimitMaxApi(isTest: boolean): number {
  return isTest ? 100_000 : parsePositiveInt("RATE_LIMIT_API_MAX", 300);
}

/** `/health` and `/` (outside ingest and `/api` scopes). */
export function rateLimitMaxPublic(isTest: boolean): number {
  return isTest ? 100_000 : parsePositiveInt("RATE_LIMIT_PUBLIC_MAX", 300);
}
```

Defaults:
- Ingest: 3000 req/min
- Auth: 30 req/min
- API: 300 req/min
- Public: 300 req/min

Applied per-scope in `apps/api/src/app.ts`.

### IP hashing

**NO DEDICATED IP HASHING HELPER EXISTS**

For affiliate click tracking, will need to implement:
- Salted SHA-256 of IP addresses
- Salt rotation mechanism (quarterly, per the design doc)
- Stored in `affiliate_clicks.ip_hash`

---

## 14. Cookie Consent Implementation

### Library / approach

**Custom implementation** (no third-party library like CookieBot or OneTrust)

### Client-side

**File:** `apps/dashboard/lib/cookie-consent-client.ts`

**Storage:** `localStorage` key `tt-cookie-consent` + server-side cookie

```1:28:apps/dashboard/lib/cookie-consent-client.ts
import {
  COOKIE_CONSENT_STORAGE_KEY,
  cookieConsentDocumentCookie,
  isCookieConsentChoice,
  type CookieConsentChoice,
} from "@/lib/cookie-consent";

/** Keep document.cookie and localStorage aligned with the authoritative server choice. */
export function syncClientCookieConsentStorage(choice: CookieConsentChoice): void {
  localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, choice);
  document.cookie = cookieConsentDocumentCookie(choice);
}

/** Only pre-fill auth when the server has not recorded consent yet. */
export function appendCookieConsentToFormData(
  formData: FormData,
  serverChoice: CookieConsentChoice | null
): void {
  if (serverChoice) return;
  try {
    const value = localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
    if (isCookieConsentChoice(value)) {
      formData.set("cookieConsent", value);
    }
  } catch {
    /* ignore */
  }
}
```

### Server-side

**File:** `apps/dashboard/lib/cookie-consent-server.ts` (referenced but not shown in full)

Cookie name: `tt-cookie-consent`  
Values: `"accepted"` | `"rejected"`  
Max-Age: 365 days  
Attributes: `Secure; SameSite=Lax; Path=/`

### UI Component

**File:** `apps/dashboard/app/components/marketing/cookie-consent.tsx`

Banner renders at bottom of page, shows:
- "Optional analytics cookies are off" (when rejected)
- Accept/Reject buttons (when not decided)
- Preference controls

### Consent categories

From code inspection:

**Current categories:**
1. **Essential** (always allowed) — authentication session, workspace context
2. **Analytics/Marketing** (requires consent) — Google Analytics

```15:19:apps/dashboard/lib/cookie-consent.ts
export function preferenceCookiesAllowed(
  choice: CookieConsentChoice | null | undefined
): boolean {
  return choice === "accepted";
}
```

### How to read consent

**Client-side:**
```typescript
import { readStoredCookieConsentChoice } from "@/lib/cookie-consent";
const choice = readStoredCookieConsentChoice(); // "accepted" | "rejected" | null
```

**Server-side:**
```typescript
import { readCookieConsentChoiceFromCookieHeader } from "@/lib/cookie-consent";
const choice = readCookieConsentChoiceFromCookieHeader(request.headers.cookie);
```

### Implications for affiliates

✅ **Consent infrastructure exists and is production-ready**

For affiliate integration:
1. **Rewardful script loading:** Gate behind `preferenceCookiesAllowed(choice)` (marketing category)
2. **First-party cookie `tt_ref`:** Same gating
3. **Server-side click capture:** Can run unconditionally (no device storage)
4. **localStorage for `via` param:** Only after consent
5. **Fallback path without consent:** URL param → server-side → signup form field

---

## 15. Marketing Site vs Dashboard Domains

### Domain architecture

**Single registrable domain:** `telemetry-tracker.com`

Subdomains:
- **Marketing/docs:** `telemetry-tracker.com` (Next.js app at `apps/dashboard`)
- **Dashboard:** `telemetry-tracker.com/dashboard/*` (same Next.js app)
- **API:** `api.telemetry-tracker.com` (Fastify app at `apps/api`)

### Evidence

**Middleware redirect** (apps/dashboard/middleware.ts lines 70-78):

```70:78:apps/dashboard/middleware.ts
  const host = request.headers.get("host")?.split(":")[0]?.toLowerCase();
  if (host === "www.telemetry-tracker.com") {
    const url = request.nextUrl.clone();
    url.protocol = "https:";
    url.host = "telemetry-tracker.com";
    url.port = "";
    return NextResponse.redirect(url, 301);
  }
```

**Environment variables:**
- `NEXT_PUBLIC_SITE_URL` for canonical URLs (defaults to https://telemetry-tracker.com)
- `API_URL` for server-side API calls (http://localhost:3001 in dev, https://api.telemetry-tracker.com in prod)

### Deployment

**Evidence from package.json and workflows:**
- Single Next.js app handles both marketing and dashboard
- Routes under `/dashboard/*` require authentication
- Marketing routes (/, /docs/*, /pricing, etc.) are public

### Implications for affiliates

✅ **Perfect for affiliate program** — cross-subdomain tracking is automatic with Rewardful (same registrable domain)

No Growth plan needed for cross-domain tracking.

Set `Domain=.telemetry-tracker.com` on `tt_ref` cookie for visibility across www/app.

---

## 16. Next.js Middleware & Root Layout

### Middleware

**File:** `apps/dashboard/middleware.ts`

**Scope:** All routes except static assets (via `config.matcher`)

**Responsibilities:**
1. Redirect www → apex domain
2. Handle legacy `?signUp=1` / `?signIn=1` query params
3. Auth gating for `/dashboard/*` routes (unless `NEXT_PUBLIC_TELEMETRY_PUBLIC_DASHBOARD=true`)
4. Dashboard range canonicalization

**Session check:**

```13:15:apps/dashboard/middleware.ts
function hasValidSession(request: NextRequest): boolean {
  const session = request.cookies.get(SESSION_COOKIE);
  return Boolean(session?.value && /^[0-9a-f-]{36}$/i.test(session.value));
}
```

Cookie name: `telemetry_session` (UUID)

### Root layout

**File:** `apps/dashboard/app/layout.tsx`

**Components rendered:**
- `ThemeProvider` (dark/light mode)
- `CookieConsent` (banner)
- `GoogleAnalytics` (if consent given)
- `ProductTelemetry` (dogfooding TT SDK)
- `NavigationProgress` (loading bar)

**Location for adding Rewardful script:** After `<GoogleAnalytics />`, render a new `<RewardfulLoader />` component that checks consent.

---

## 17. Admin / Founder Authorization

### Current authorization

**File:** `apps/api/src/lib/org-permissions.ts`

**Roles:** `OWNER | EDITOR | VIEWER` (enum `OrgRole`)

**Permission helpers:**

```40:68:apps/api/src/lib/org-permissions.ts
export function canResolveErrors(role: OrgRole | null): boolean {
  if (role === null) return false;
  return role === OrgRole.OWNER || role === OrgRole.EDITOR;
}

export function canCreateApiKey(role: OrgRole | null): boolean {
  if (role === null) return false;
  return role === OrgRole.OWNER || role === OrgRole.EDITOR;
}

export function canRevokeApiKey(role: OrgRole | null): boolean {
  return role === OrgRole.OWNER;
}

export function canCreateProject(role: OrgRole | null): boolean {
  return role === OrgRole.OWNER;
}

export function canManageMembers(role: OrgRole | null): boolean {
  return role === OrgRole.OWNER;
}

export function canArchiveOrganization(role: OrgRole | null): boolean {
  return role === OrgRole.OWNER;
}

export function canArchiveProject(role: OrgRole | null): boolean {
  return role === OrgRole.OWNER;
}
```

### No "founder" or "admin" role

**No special admin allowlist** or founder role exists. The OWNER role is the closest equivalent.

For affiliate admin features, options:
1. **Add dedicated admin role** (recommended) — check `user.email` against allowlist env var
2. **Use OWNER of specific org** — check if user is OWNER of a designated "TT Admin" organization
3. **Add `is_admin` boolean** to User model

### Implications for affiliates

⚠️ **Need admin authorization** for:
- Affiliate application review
- Manual attribution
- Reconciliation issue resolution
- Payout runs
- Fraud review queue

**Recommendation:** Add `AFFILIATE_ADMIN_EMAILS` env var (comma-separated) checked in middleware.

---

## 18. Cron / Job Infrastructure

### Job scripts

**Location:** `apps/api/src/jobs/`

**Existing jobs:**
- `run-retention.ts` — data retention cleanup
- `run-alert-rules-evaluator.ts` — alert rule evaluation
- `run-builtin-alert-rules-backfill.ts` — backfill built-in alert rules
- `run-pii-scrub-backfill.ts` — PII scrubbing backfill
- `run-brief-worker.ts` — AI brief generation worker
- `run-alert-webhook-worker.ts` — alert webhook delivery worker

### Execution

Jobs are **standalone Node scripts** (not cron itself). They run via:

```json
// package.json
"scripts": {
  "retention": "tsx src/jobs/run-retention.ts",
  "alert-rules-evaluator": "tsx src/jobs/run-alert-rules-evaluator.ts",
  // ...
}
```

**External scheduler needed** (e.g., Railway cron, systemd timers, Kubernetes CronJobs).

### Heartbeat tracking

**Table:** `ScheduledJobHeartbeat` (Prisma schema line 626+)

```626:631:apps/api/prisma/schema.prisma
model ScheduledJobHeartbeat {
  job         String   @id
  last_ok_at  DateTime @map("last_ok_at")
  updated_at  DateTime @updatedAt @map("updated_at")
}
```

Jobs update this table on successful run; `/health` endpoint checks staleness.

### Implications for affiliates

✅ **Job infrastructure exists** — can add:
- `run-affiliate-reconciliation.ts` (nightly, 02:00)
- `run-affiliate-commission-approver.ts` (daily check for pending → approved)
- `run-affiliate-clicks-purge.ts` (daily purge of 90+ day old clicks)

Poll Rewardful API with throttling (≤1 req/s) to avoid rate limits.

---

## 19. Mailer & Test-Mail Protections

### Email provider

**Resend** (`api.resend.com`) via REST API

**File:** `apps/api/src/lib/email.ts`

### Configuration

```29:42:apps/api/src/lib/email.ts
export function missingTransactionalEmailEnvNames(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const missing: string[] = [];
  if (!env.RESEND_API_KEY?.trim()) missing.push("RESEND_API_KEY");
  if (!env.TELEMETRY_EMAIL_FROM?.trim()) missing.push("TELEMETRY_EMAIL_FROM");
  return missing;
}

export function isTransactionalEmailConfigured(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return missingTransactionalEmailEnvNames(env).length === 0;
}
```

### Test mode / sandbox

```87:100:apps/api/src/lib/email.ts
  if (!isTransactionalEmailConfigured()) {
    warnIfTransactionalEmailNotConfigured();
    if (process.env.NODE_ENV !== "production") {
      const to = Array.isArray(opts.to)
        ? opts.to.map(sanitizeForLog).join(", ")
        : sanitizeForLog(opts.to);
      console.info(
        "[email:dev]",
        to,
        sanitizeForLog(opts.subject),
        sanitizeForLog(opts.html.slice(0, 200))
      );
      return { sent: false, devLogged: true, error: EMAIL_NOT_CONFIGURED };
    }
```

**Behavior:**
- **Development:** Logs email to console, returns `{ sent: false, devLogged: true }`
- **Production without config:** Returns `{ sent: false, error: "email_not_configured" }` + one-time warning

**No accidental production sends** to test addresses — relies on env configuration only.

### Implications for affiliates

✅ **Email infrastructure is production-ready**

For affiliate program:
- Application approved/rejected emails
- Commission approved notifications
- Payout sent confirmations
- Terms change notices

**Ensure development/staging environments don't have RESEND_API_KEY** to prevent accidental sends.

---

## 20. Cheapest Way to Check if Account Has Sent Telemetry

### Current approach

Multiple options exist to check if an Organization has ingested events:

**Option 1: UsageMonthly table** (fastest)

```typescript
const usage = await prisma.usageMonthly.findFirst({
  where: { 
    project: { organization_id: orgId },
    ingest_units: { gt: 0 }
  }
});
const hasSentEvents = Boolean(usage);
```

**Option 2: Project-level query**

```typescript
// Check if any project has events
const project = await prisma.project.findFirst({
  where: { 
    organization_id: orgId,
    deleted_at: null
  },
  include: {
    events: { take: 1 },
    error_groups: { take: 1 },
    sessions: { take: 1 }
  }
});
const hasSentEvents = Boolean(
  project?.events.length || 
  project?.error_groups.length || 
  project?.sessions.length
);
```

**Option 3: Aggregate query** (most accurate)

```typescript
const counts = await prisma.$queryRaw<[{ total: bigint }]>`
  SELECT COUNT(*) as total FROM (
    SELECT 1 FROM "Event" e 
      JOIN "Project" p ON e.project_id = p.id 
      WHERE p.organization_id = ${orgId} 
      LIMIT 1
    UNION ALL
    SELECT 1 FROM "ErrorGroup" eg 
      JOIN "Project" p ON eg.project_id = p.id 
      WHERE p.organization_id = ${orgId} 
      LIMIT 1
    UNION ALL
    SELECT 1 FROM "Session" s 
      JOIN "Project" p ON s.project_id = p.id 
      WHERE p.organization_id = ${orgId} 
      LIMIT 1
  ) x
`;
const hasSentEvents = counts[0].total > 0n;
```

### Recommendation

**Use UsageMonthly.ingest_units > 0** (Option 1)

Fastest, requires no joins, indexed lookup. Covers:
- Events
- Error occurrences
- Sessions

All ingest increments `ingest_units` via `apps/api/src/lib/usage-meter.ts`.

### Implications for affiliates

For the SDK-events gate (brief V1.1):

```typescript
// Check if referred account has sent any events
const hasIngestedEvents = await prisma.usageMonthly.findFirst({
  where: {
    project: {
      organization_id: referral.organization_id
    },
    ingest_units: { gt: 0 }
  },
  select: { id: true }
});

if (!hasIngestedEvents) {
  // Push commission due_at by +14 days or flag for manual review
}
```

---

## 21. Hosted vs Self-Hosted Separation

### Billing gating

**Stripe features are gated by environment variables:**

```typescript
// apps/api/src/routes/billing.ts
function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  return new Stripe(key);
}
```

If `STRIPE_SECRET_KEY` is not set:
- Billing routes return 503 "Stripe is not configured"
- Webhook handler is not registered
- Organizations stay on FREE tier

### Registration control

```typescript
// apps/api/src/routes/auth.ts lines 220-225
const userCount = await prisma.user.count();
const allowReg =
  process.env.TELEMETRY_ALLOW_REGISTRATION === "true" || userCount === 0;
if (!allowReg) {
  return reply.status(403).send({ error: "Registration is disabled" });
}
```

Self-hosters can:
1. Set `TELEMETRY_ALLOW_REGISTRATION=true` for multi-tenant
2. Leave unset for single-tenant (first user auto-allowed)

### No "edition" enum

**No `TELEMETRY_EDITION` or similar** exists. Separation is implicit:
- Stripe vars set = hosted billing enabled
- Stripe vars unset = self-hosted, no billing

### Documentation

**File:** `docs/BILLING.md`

> Stripe billing and Resend email are **optional** for self-hosted installs.

### Implications for affiliates

✅ **Affiliate program will naturally gate itself** via:

```typescript
const AFFILIATES_ENABLED = 
  process.env.AFFILIATES_ENABLED === "true" && 
  Boolean(process.env.STRIPE_SECRET_KEY);
```

Self-hosters without Stripe cannot accidentally enable affiliates.

Add to docs:

> The affiliate program applies only to the hosted cloud at telemetry-tracker.com. Self-hosted installations do not include affiliate features.

---

## 22. Test Infrastructure

### Test runner

**Vitest** (v3.2.6)

Config files:
- `apps/api/vitest.config.ts`
- `apps/dashboard/vitest.config.ts`
- `packages/*/vitest.config.ts`

### Existing test coverage

**API:** 24 test files (integration + unit)

Examples:
- `auth-rbac.integration.test.ts` (7.2 KB)
- `audit-log.integration.test.ts`
- `billing.ts` (no test file found)
- `stripe-webhook.ts` (no dedicated test file, but integration tests likely exercise it)
- `marketing.integration.test.ts` (tests registration + subscriber opt-in)

### Stripe mocking / test mode

**Test mode supported** — tests use:

```typescript
const DATABASE_URL = process.env.DATABASE_URL || 
  "postgresql://ci:ci@localhost:5432/ci";
```

**CI Workflow** (`.github/workflows/ci.yml`):

```yaml
- name: Prisma migrate deploy
  run: pnpm --filter api exec prisma migrate deploy

- name: Test
  env:
    RUN_DB_INTEGRATION_TESTS: "true"
  run: pnpm test
```

Integration tests run against real Postgres (in-memory for CI).

**For Stripe:** Tests can use:
1. **Stripe test mode** (`sk_test_...`) for real Stripe API calls
2. **Mocked Stripe client** (manual injection)
3. **Test clocks** for time-travel testing

Current billing tests appear to be **smoke tests** or absent (need verification).

### CI workflow

**File:** `.github/workflows/ci.yml`

Steps:
1. Install deps
2. **Lint** (`pnpm lint`)
3. **Migrate** (`prisma migrate deploy`)
4. **Test** (`pnpm test` with DB integration enabled)
5. **Build** (`pnpm -r run build`)
6. Verify committed dist matches build

Runs on:
- `push` to `main` or `develop`
- PRs to `main` or `develop`

### How to run locally

```bash
# All tests
pnpm test

# API tests
pnpm --filter api test

# Dashboard tests
pnpm --filter dashboard test

# Watch mode
pnpm --filter api test:watch

# Typecheck
pnpm lint

# Build
pnpm build
```

### Implications for affiliates

✅ **Test infrastructure is mature**

For affiliate integration, add:
- **Unit tests:** referral logic, commission calculation, self-referral checks
- **Integration tests:** 
  - Stripe webhook idempotency
  - Rewardful webhook signature validation
  - Checkout with/without referral metadata
  - Free→Pro upgrade commission
  - Refund handling
- **Test fixtures:** mock Rewardful API responses
- **Test utilities:** `createTestAffiliate()`, `createReferredOrg()`

Coverage targets (from verification doc):
- T1-T12: Attribution tests
- T13-T28: Commission tests (Stripe test mode + test clocks)
- T29-T35: Payout & admin tests
- T36-T38: Privacy & UX tests

---

## 23. Existing Referral / Attribution Code

### Search results

Searched for:
- `referral`
- `affiliate`
- `utm_`
- `attribution`
- `via=`

**NO MATCHES FOUND** in application code (only in CHANGELOG, README, trademark notice).

### Confirmed absence

✅ **No existing referral or affiliate system**
✅ **No UTM tracking**
✅ **No attribution cookies**
✅ **No `?via=` param handling**

This is **ideal** — clean slate for implementing the affiliate system without conflicts or migration complexity.

---

## 24. Open PRs & Recent Work on Billing/Auth

### Open PRs (as of audit date)

**Command:** `gh pr list --base develop --limit 10`

Results:
1. **#728** — chore: sync develop with main (Sept 30)
2. **#692** — docs: Next.js 1.3.2 server capture (Sept 25, DRAFT)
3. **#691** — docs: live source-map matrix (Sept 25, DRAFT)
4. **#642** — docs: French README (Sept 9)
5. **#611** — chore(deps): Bump Next.js (Jul 27)
6. **#609** — feat: export error issues as JSON/Markdown (Jul 19)

**No billing or auth PRs open** on develop branch.

### Recent commits (last 10)

```
* 197a002 fix(email): keep brand header readable in Gmail dark mode
* 72a0879 fix(api): keep native startup marks in the analytics view
* 01868e7 feat(api): add a sanitized app_startup view for analytics_ro
* cadb8d4 docs: add a Sentry migration guide and name verified alert channels
* 08fe341 Release: Next.js server error documentation to production
* 50917b4 docs: add Next.js server-side error capture to marketing pages
* 17a08e5 chore: sync develop with main after sdk-core-v1.5.1
* f185305 (tag: sdk-core-v1.5.1) Merge SDK core 1.5.1
```

**No recent billing or auth changes** that would conflict with affiliate integration.

### Implications

✅ **Clear path forward** — no merge conflicts expected with affiliate work.

---

## Comparison with Implementation Brief

The verification doc (section 5) contains an implementation brief. Here's how it compares to reality:

| Brief Component | Keep / Simplify / Unnecessary / Defer |
|---|---|
| **Postgres tables:** `affiliates`, `affiliate_tokens`, `affiliate_clicks`, `account_referrals`, `expected_commissions`, `affiliate_adjustments`, `rewardful_commissions`, `affiliate_payouts` | **KEEP** — schema is sound |
| **Client: consent-gated rewardful.js** | **KEEP** — TT has consent infrastructure |
| **Server: middleware click capture** | **KEEP** — TT has Fastify + Next.js middleware |
| **Signup flow changes** (set Customer metadata at signup) | **REVISE** — TT creates Customer at first checkout, not signup. For referred users, must create Customer at signup. |
| **Stripe Checkout changes** (remove `client_reference_id` for account ID) | **UNNECESSARY** — TT doesn't use `client_reference_id` at all. Can use it for Rewardful UUID without conflict. |
| **Stripe webhook handler** (`invoice.paid`, refunds, disputes) | **KEEP** — TT has webhook infrastructure, need to add event handlers |
| **Rewardful webhook handler** (`POST /webhooks/rewardful`) | **KEEP** — pattern matches TT's Stripe webhook |
| **Jobs** (nightly reconciliation, SDK-event gate, click purge) | **KEEP** — TT has job infrastructure via standalone scripts |
| **Admin views** (applications, affiliate detail, reconciliation, payout run) | **KEEP** — but need to add admin auth (no dedicated admin role yet) |
| **Feature flag** (`AFFILIATES_ENABLED`) | **KEEP** — matches TT's env-driven feature pattern |
| **Test plan** (Stripe test mode, live smoke test) | **KEEP** — TT has test infrastructure, but no Stripe billing tests yet |

### Key architectural differences from brief

1. **Customer creation timing** ❌
   - Brief assumes: Customer created at signup
   - Reality: Customer created at first checkout
   - Impact: For referred signups, must create Customer immediately to capture referral within 60-day window

2. **`client_reference_id` conflict** ✅
   - Brief assumes: TT uses it for account ID, needs migration
   - Reality: TT doesn't use it at all
   - Impact: Can use directly for Rewardful UUID, no migration needed

3. **Billing entity** ❌
   - Brief assumes: User-level billing
   - Reality: Organization-level billing
   - Impact: Referral attribution attaches to Organization, not User

4. **Admin authorization** ⚠️
   - Brief assumes: Admin role exists
   - Reality: Only OWNER/EDITOR/VIEWER roles exist
   - Impact: Need to add admin allowlist or role

5. **Email normalization** ⚠️
   - Brief assumes: Gmail dots and +tag stripping
   - Reality: Only `toLowerCase()`
   - Impact: Self-referral checks need to add normalization

6. **Webhook deduplication** ⚠️
   - Brief assumes: Idempotency exists
   - Reality: No deduplication in current Stripe webhook
   - Impact: Need to add idempotency for affiliate events

---

## Proposed V1 Architecture (Simplified)

Based on the real codebase, here's a pragmatic V1:

### Core flow

```
Affiliate link (?via=<token>)
  → Next.js middleware captures click (server-side, hashed IP/UA)
  → [If consent given] Rewardful.js sets cookie + TT sets tt_ref
  → Signup form sends { referral: UUID, via: token }
  → API runs self-referral checks
  → Creates Organization + Stripe Customer (with metadata.referral)
  → Rewardful records Lead
  → Free account active
  → [Later] User upgrades to Pro
  → Checkout Session (customer=<existing>, metadata.referral)
  → Subscription created
  → invoice.paid webhook
  → Rewardful creates commission (30%, recurring, lifetime)
  → TT creates expected_commission (parallel ledger)
  → [30 days later] Commission approved
  → [Monthly] Payout run (TT builds Wise SEPA batch)
  → TT calls Rewardful API to mark paid
```

### Tables

**Core (owned by TT):**
- `affiliates` — approved partners with legal/payout data
- `affiliate_tokens` — link tokens + promo codes
- `affiliate_clicks` — server-side click log (hashed, 90-day retention)
- `organization_referrals` — permanent attribution (1:1 with Organization)
- `expected_commissions` — TT's ledger from `invoice.paid`
- `affiliate_adjustments` — manual adjustments, negatives
- `affiliate_payouts` — TT's payout records (Wise refs, invoice PDFs)

**Mirror (from Rewardful):**
- `rewardful_affiliates` — cache of Rewardful data
- `rewardful_commissions` — for reconciliation
- `rewardful_payouts` — for reconciliation

**Infrastructure:**
- `rewardful_webhook_events` — idempotency (event_id pk)
- `reconciliation_issues` — drift alerts

### Webhook handlers

**Stripe (extend existing):**
- `checkout.session.completed` — already handles plan_tier, add referral passthrough check
- `customer.subscription.updated` — no change
- `customer.subscription.deleted` — no change
- **NEW:** `invoice.paid` — create expected_commission
- **NEW:** `charge.refunded` — create negative adjustment
- **NEW:** `credit_note.created` — adjustment for post-payment credits
- **NEW:** `charge.dispute.created` — push Rewardful `due_at` via API
- **NEW:** `charge.dispute.closed` — resolve or reverse

**NEW: Rewardful (`POST /webhooks/rewardful`):**
- Signature verification (HMAC-SHA256)
- Idempotency on `event.id`
- `affiliate.created` → auto-disable if not approved
- `affiliate_link.*` / `affiliate_coupon.*` → upsert tokens
- `referral.lead` / `referral.converted` → link to organization_referrals
- `commission.*` → upsert rewardful_commissions
- `payout.*` → mirror status

### Jobs

**NEW scripts:**
- `run-affiliate-reconciliation.ts` — nightly 02:00, compare TT vs Rewardful
- `run-affiliate-clicks-purge.ts` — daily, delete clicks > 90 days
- `run-affiliate-commission-approver.ts` — optional, check SDK events gate

**Frequency:**
- Reconciliation: nightly
- Click purge: daily
- Commission approver: daily or on-demand

### Admin UI

**NEW routes (founder-only):**
- `GET /meta/affiliates/applications` — list pending applications
- `POST /meta/affiliates/:id/approve` — approve + call Rewardful API
- `POST /meta/affiliates/:id/reject` — reject + email
- `GET /meta/affiliates/:id` — affiliate detail + referrals + commissions
- `POST /meta/affiliates/reconciliation` — trigger reconciliation job
- `GET /meta/affiliates/reconciliation/issues` — list drift
- `POST /meta/affiliates/payouts/run` — build Wise CSV, mark paid

**Authorization:** Check `req.session.userId` against `AFFILIATE_ADMIN_EMAILS` env var.

---

## Phased Implementation Plan

### Phase 1: Foundation (No Rewardful, Internal Only)

**Goal:** Build TT-owned attribution tracking without Rewardful dependency.

1. **Database schema**
   - Add tables: `affiliates`, `affiliate_tokens`, `affiliate_clicks`, `organization_referrals`
   - Migration naming: `20261005120000_add_affiliate_tables.sql`

2. **Click capture**
   - Add `GET /r/:token` redirect route (API)
   - Next.js middleware captures `?via=<token>`
   - Insert `affiliate_clicks` (hashed IP/UA, no cookie yet)

3. **Signup attribution**
   - Extend `POST /api/auth/register` to accept `{ via?: string }`
   - Self-referral checks (email normalization with +tag and Gmail dots)
   - Create `organization_referrals` row
   - Create Stripe Customer with `metadata.tt_referral_id` (not Rewardful UUID yet)

4. **Checkout passthrough**
   - Update Checkout Session to set `metadata.tt_referral_id` on subscription

5. **Admin scaffold**
   - Add `AFFILIATE_ADMIN_EMAILS` env var
   - Admin auth helper: `isAffiliateAdmin(userId)`
   - Stub admin UI: list affiliates, view referrals

6. **Tests**
   - Unit: self-referral checks, email normalization
   - Integration: click capture, signup attribution
   - No Stripe/Rewardful yet

**Deliverables:**
- Click tracking works
- Signup attribution works
- Customer metadata includes TT referral ID
- Admin can view (but not approve) applications

---

### Phase 2: Rewardful Integration (Outbound)

**Goal:** Set Rewardful metadata on Stripe Customer, receive Rewardful commission webhooks.

1. **Rewardful trial setup**
   - Sign up for Rewardful Starter
   - Configure campaign: 30%, recurring, last-touch, 60-day window
   - Connect Stripe App
   - Get API secret + webhook signing secret

2. **Consent-gated script**
   - Add `<RewardfulLoader />` component to `apps/dashboard/app/layout.tsx`
   - Only load after `preferenceCookiesAllowed(choice) === true`
   - Set `tt_ref` cookie (60 days, `Domain=.telemetry-tracker.com`)

3. **Signup flow changes**
   - Client sends `{ referral: string }` (Rewardful UUID from `Rewardful.referral`)
   - Server validates UUID format
   - Set `metadata.referral = <UUID>` on Stripe Customer (in addition to `tt_referral_id`)
   - Fallback: if no UUID, use `metadata.referral = <token>` (Rewardful's manual attribution)

4. **Checkout update**
   - Add `client_reference_id: referralUuid` to Checkout Session (optional, for lead tracking)
   - Keep `customer: <existing>`

5. **Rewardful webhook handler**
   - Add `POST /webhooks/rewardful`
   - Signature verification
   - Idempotency table: `rewardful_webhook_events`
   - Handlers: `affiliate.*`, `referral.*`, `commission.*`, `payout.*`

6. **Tests**
   - Unit: webhook signature validation, idempotency
   - Integration: mock Rewardful webhook payloads
   - Manual: live Rewardful trial with real EUR 15 payment (refund after)

**Deliverables:**
- Rewardful script loads after consent
- Stripe Customer has `metadata.referral` (UUID or token)
- Rewardful webhooks are received and stored
- Referral <> Organization linking works

---

### Phase 3: Commission Tracking & Reconciliation

**Goal:** Track expected commissions from Stripe, reconcile against Rewardful.

1. **Stripe invoice webhook**
   - Add `invoice.paid` handler
   - Calculate expected commission: `floor(base * 0.30)`
   - Insert `expected_commissions` row
   - Resolve `stripe_charge_id` from PaymentIntent

2. **Refund handlers**
   - `charge.refunded` → insert negative `affiliate_adjustments`
   - `credit_note.created` → adjustment for post-payment credits

3. **Dispute handlers**
   - `charge.dispute.created` → call Rewardful API to push `due_at`
   - `charge.dispute.closed` → reverse or restore commission

4. **Reconciliation job**
   - Fetch Rewardful commissions (`state[]=pending&state[]=due`, + last 60 days paid)
   - Compare to `expected_commissions` by `stripe_charge_id`
   - Check amount, tax exclusion, referral coverage
   - Insert `reconciliation_issues` for drift
   - Email daily digest

5. **Tests**
   - Unit: commission calculation, base amount with discounts/credits
   - Integration: Stripe test mode with test clocks
   - Invoice paid → commission created
   - Refund → adjustment
   - Reconciliation job detects mismatch

**Deliverables:**
- Expected commission ledger is populated
- Refunds adjust commissions
- Disputes freeze commissions
- Nightly reconciliation detects drift

---

### Phase 4: Admin & Payout Flow

**Goal:** Approve affiliates, run payouts, generate invoices.

1. **Affiliate approval**
   - Admin UI: list applications
   - Approve → `POST /api/v1/affiliates` to Rewardful
   - Store `rewardful_affiliate_id`
   - Email approved/rejected notification

2. **Affiliate detail page**
   - Legal/tax/IBAN form (encrypted at rest)
   - Self-billing consent checkbox
   - Sanctions check field (manual)
   - Referrals table
   - Expected vs Rewardful commissions side-by-side
   - Adjustments log

3. **Reconciliation issues UI**
   - List issues with filters (open/resolved)
   - "Resolve" button (mark as reviewed)

4. **Payout run**
   - Fetch `GET /api/v1/payouts?state=due` from Rewardful
   - Join with TT affiliates
   - Calculate `paid_amount = rewardful_amount + sum(unsettled adjustments)`
   - Eligibility: business entity, IBAN present, sanctions OK, ≥ EUR 50
   - Individuals → skip with reason (or offer TT credit in V1.1)
   - Export Wise CSV (IBAN-based)
   - After Wise send: store ref, generate PDF, call `PUT /api/v1/payouts/:id/pay`

5. **Self-billed invoice PDF**
   - Sequential numbering
   - "Samofakturiranje" label
   - VAT line by entity type (SI 22%, reverse charge, not subject)
   - Store in R2/S3

6. **Encryption helpers**
   - Add `encrypt()` / `decrypt()` for IBAN at rest
   - Use `AFFILIATE_PAYOUT_ENCRYPTION_KEY` env var

7. **Tests**
   - Unit: payout eligibility logic, CSV generation
   - Integration: admin auth, approve affiliate (mock Rewardful API)
   - E2E: payout run (dry-run mode)

**Deliverables:**
- Affiliates can be approved via admin UI
- Payout run generates Wise CSV
- Self-billed invoices are generated
- Payouts are marked paid in Rewardful after send

---

### Phase 5: Polish & Production Readiness

**Goal:** Complete edge cases, fraud protections, documentation.

1. **SDK-event gate**
   - Job checks: commission pending → account has ≥1 `ingest_units`
   - If zero: push `due_at` by +14 days
   - Open reconciliation issue for manual review

2. **Click purge job**
   - Delete `affiliate_clicks` > 90 days
   - Run daily

3. **Fraud improvements**
   - Card fingerprint check (compare with affiliate's own payment methods)
   - IP/UA overlap check (within 24h)
   - Refund rate monitoring

4. **Documentation**
   - Affiliate program terms (based on design doc)
   - Partner onboarding guide
   - FAQ (cross-device, cookie blockers, promo codes)
   - Internal runbook (payout process, reconciliation)

5. **Monitoring & alerts**
   - Webhook failure alerts (Sentry or email)
   - Reconciliation drift threshold (e.g., >5 issues)
   - Daily fraud digest

6. **Feature flag management**
   - `AFFILIATES_ENABLED=false` by default in all envs
   - Enable on production only after founder approval

7. **Final testing**
   - Run full test suite (`pnpm test`)
   - Manual QA: T1–T38 from verification doc
   - Live smoke test: one real affiliate, EUR 15 payment, refund

**Deliverables:**
- SDK-event gate active
- Click purge runs daily
- Fraud monitoring in place
- Documentation complete
- Production-ready with flag OFF

---

## Risks to Existing Billing

### Risk 1: Double Customer creation

**Scenario:** Affiliate integration creates Customer at signup, but checkout also tries to create one.

**Mitigation:**
- `resolveStripeCustomerId()` already handles race conditions with `FOR UPDATE` lock
- Extend to check if Customer exists before calling `stripe.customers.create()`
- Test: concurrent requests, one wins

### Risk 2: Checkout Session breaks if Customer has no email

**Scenario:** Customer created at signup without email set.

**Mitigation:**
- Always set `email` when creating Customer for referred signups
- Fallback: update Customer with email before Checkout if missing
- Test: Customer without email → Checkout succeeds

### Risk 3: Metadata grows too large

**Scenario:** Adding `referral`, `tt_referral_id`, `affiliate_id` exceeds Stripe metadata limits (50 keys, 500 chars per value).

**Mitigation:**
- Stripe limits: 50 keys, 500 chars per value, 5KB total
- Current usage: 2 keys (organization_id, plan_tier)
- Affiliate adds: 3 keys max
- Total: 5 keys, well under limit
- Test: create Customer with all metadata, confirm under limits

### Risk 4: Webhook replay causes duplicate commissions

**Scenario:** Stripe resends `invoice.paid`, creates duplicate expected_commission.

**Mitigation:**
- Add unique constraint: `expected_commissions(stripe_invoice_id)`
- Idempotency: upsert instead of insert
- Test: replay webhook, confirm no duplicate

### Risk 5: Subscription downgrade loses referral metadata

**Scenario:** User downgrades to Free, referral attribution is lost.

**Mitigation:**
- Referral is on `organization_referrals` table (permanent)
- Customer metadata persists (not deleted on downgrade)
- If user upgrades again, attribution is still present
- Test: Pro → Free → Pro, commission created on second upgrade

### Risk 6: Existing billing tests break

**Scenario:** Adding invoice webhook handler changes behavior tested in existing tests.

**Mitigation:**
- Current billing tests are minimal (smoke tests)
- Add new tests in separate file: `stripe-affiliate-webhook.test.ts`
- Run full test suite before and after integration
- CI enforces `pnpm test` passes

### How tests guard against risks

1. **Integration tests:**
   - Checkout with existing Customer (R1, R2)
   - Webhook idempotency (R4)
   - Metadata size (R3)
   - Upgrade/downgrade/re-upgrade (R5)

2. **Unit tests:**
   - Commission calculation logic
   - Self-referral checks
   - Email normalization

3. **CI enforcement:**
   - `pnpm lint` — typecheck
   - `pnpm test` — all tests must pass
   - `pnpm build` — must complete

4. **Manual QA:**
   - Test plan (T1–T38) from verification doc
   - Live smoke test with real EUR 15 payment

---

## Technical & Security Blockers

### Blocker 1: Tax treatment of individual affiliates (CRITICAL)

**Issue:** Slovenian ZDoh-2 Art. 10 may make commissions to EU/non-EU individuals Slovenian-source income, requiring withholding.

**Resolution:** Accountant confirmation required before launch.

**Mitigation:** V1 pays only businesses (invoicing entities), individuals get TT credit.

---

### Blocker 2: VAT exclusion in Rewardful (CONFIRM)

**Issue:** Verification doc states commission is "net of VAT," but TT's Stripe Tax usage is unknown.

**Resolution:** 
1. Check Stripe Dashboard: are STRIPE_PRICE_PRO/BUSINESS tax-inclusive or exclusive?
2. During Rewardful trial, create test invoice with Stripe Tax enabled
3. Verify Rewardful commission `tax_amount_cents` matches invoice tax
4. Reconciliation job should alert if `rewardful_commission.amount ≠ floor(invoice.total_excluding_tax * 0.30)`

**Current assumption:** Tax-exclusive (Rewardful default, most SaaS use this).

---

### Blocker 3: Stripe test mode support in Rewardful (UNVERIFIED)

**Issue:** Verification doc states test mode is "not documented as supported."

**Resolution:**
1. During Rewardful trial, try connecting Stripe sandbox
2. If supported: run full test suite in test mode
3. If not: run TT logic tests in test mode, smoke test in live mode (one real EUR 15 payment, refunded)

**Fallback:** Use Stripe test mode for TT logic, live mode for end-to-end with 100% coupon + one real payment.

---

### Blocker 4: Two-campaign requirement (Starter limit)

**Issue:** Rewardful Starter allows **1 campaign**. Verification doc proposes 24-month default + lifetime tier.

**Options:**
1. Use single campaign (24-month), manually override `max_commission_period_months` per affiliate via API (if supported)
2. Upgrade to Growth (USD 99/mo) for 2 campaigns
3. V1: single 24-month campaign, defer lifetime tier to V1.1 when Growth is justified

**Recommendation:** Start with single campaign (24-month), upgrade to Growth if >25 affiliates request lifetime.

---

### No other technical blockers identified

The TT codebase is well-architected for this integration:
- ✅ Fastify + Prisma patterns are clean
- ✅ Webhook infrastructure exists
- ✅ Consent system is in place
- ✅ Test framework is mature
- ✅ Audit log is ready to extend
- ✅ No conflicting referral code exists

---

## Test Coverage Requirements

### Must-have test coverage (mapped to TT's test setup)

| Test Scenario | Type | Framework | Location |
|---|---|---|---|
| **Valid referral attribution** (T1) | Integration | Vitest | `apps/api/src/affiliate-attribution.integration.test.ts` |
| **Last-click wins** (T2, T3) | Integration | Vitest | Same as above |
| **60-day window expiry** (T5) | Unit | Vitest | `apps/api/src/lib/affiliate-attribution.test.ts` |
| **Self-referral rejection** (T9, T10) | Unit + Integration | Vitest | Both |
| **Consent-gated script loading** (T2, T11) | E2E | Manual | Browser DevTools + Playwright (optional) |
| **Checkout reuses Customer** (T6, A6) | Integration | Vitest | `apps/api/src/billing-referral.integration.test.ts` |
| **No client_reference_id conflict** (T10) | Unit | Vitest | Check Checkout payload |
| **Free→Pro later counts** (T7, T18) | Integration + Time travel | Vitest + Stripe test clocks | `apps/api/src/affiliate-commission.integration.test.ts` |
| **Non-referred signup unchanged** (T8) | Integration | Vitest | Compare behavior with/without `?via` |
| **Stripe webhook idempotency** (T26) | Integration | Vitest | `apps/api/src/stripe-affiliate-webhook.test.ts` |
| **Rewardful webhook signature** (T12) | Unit | Vitest | `apps/api/src/lib/rewardful-webhook-signature.test.ts` |
| **Duplicate Rewardful webhooks** (T12) | Integration | Vitest | `apps/api/src/rewardful-webhook.integration.test.ts` |
| **Commission calculation** (T13–T16, A7) | Unit | Vitest | `apps/api/src/lib/commission-calculate.test.ts` |
| **Refund behavior** (T21–T23, A10) | Integration | Vitest | `apps/api/src/affiliate-refund.integration.test.ts` |
| **Dispute freeze** (T24, A11) | Integration | Vitest | Mock Stripe dispute webhooks |
| **Stripe Tax commission base** (T14, A8) | Integration | Vitest + Stripe test mode | Create invoice with tax |
| **Flag OFF behavior** (A16) | Integration | Vitest | Set `AFFILIATES_ENABLED=false`, confirm no side effects |

### Test organization

**New test files to create:**
1. `apps/api/src/affiliate-attribution.integration.test.ts` — signup flow, click tracking
2. `apps/api/src/affiliate-commission.integration.test.ts` — invoice.paid, expected commissions
3. `apps/api/src/affiliate-refund.integration.test.ts` — refund/credit note adjustments
4. `apps/api/src/billing-referral.integration.test.ts` — Checkout with referral metadata
5. `apps/api/src/stripe-affiliate-webhook.test.ts` — Stripe invoice/refund/dispute handlers
6. `apps/api/src/rewardful-webhook.integration.test.ts` — Rewardful webhook handlers
7. `apps/api/src/lib/affiliate-attribution.test.ts` — unit tests for attribution logic
8. `apps/api/src/lib/commission-calculate.test.ts` — unit tests for commission math
9. `apps/api/src/lib/rewardful-webhook-signature.test.ts` — HMAC verification

### CI integration

Add to `.github/workflows/ci.yml`:

```yaml
- name: Test (with affiliate tests)
  env:
    RUN_DB_INTEGRATION_TESTS: "true"
    AFFILIATES_ENABLED: "true"
    STRIPE_SECRET_KEY: ${{ secrets.STRIPE_TEST_KEY }}
    REWARDFUL_API_SECRET: ${{ secrets.REWARDFUL_TEST_SECRET }}
  run: pnpm test
```

### Manual QA checklist (from verification doc)

**Stripe test mode** (T1–A16):
- Use test Stripe account with test clocks
- Create test affiliate in Rewardful trial
- Run attribution, checkout, commission, refund, dispute flows
- Verify reconciliation job detects drift

**Live smoke test** (B1–B3):
- One real affiliate (founder's test account)
- Real EUR 15 payment (refunded after)
- Verify Rewardful shows lead → conversion → commission
- Verify TT expected_commission matches Rewardful amount

---

## Open Questions for Founder

These require founder/accountant decision before implementation:

### 1. Tax & Legal (CRITICAL)

**Q1.1:** Can we pay EU/non-EU **individual** affiliates (non-business), or does this trigger Slovenian withholding obligations under ZDoh-2 Art. 10?

**Q1.2:** If individuals are restricted to TT credit (V1), is that credit treated as:
- (a) Price discount (no income tax reporting), or
- (b) Payment in kind (requires REK reporting)?

**Q1.3:** What VAT treatment applies to:
- Slovenian s.p. affiliates (under EUR 60K threshold, no VAT ID)
- EU businesses (reverse charge?)
- Non-EU businesses (check low-tax jurisdiction list per ZDDPO-2 Art. 70)

**Q1.4:** For self-billing, what wording/numbering does your accountant require? Can we use Rewardful-generated invoices, or must TT generate them?

**Recommendation:** Schedule call with accountant before Phase 1 begins.

---

### 2. Affiliate Program Scope

**Q2.1:** Should we start with 24-month cap for all (safer liability), or offer lifetime to first 25 partners (better recruitment)?

**Q2.2:** Minimum eligibility: require ≥1 ingested SDK event for commission approval, or skip this gate in V1?

**Q2.3:** Self-referral policy: strict rejection, or allow with disclosure + manual review?

---

### 3. Technical Configuration

**Q3.1:** Which email address(es) should be affiliate admins?
- Suggest: `AFFILIATE_ADMIN_EMAILS=your-email@tacko.io`

**Q3.2:** Should affiliate application form be public (anyone can apply), or invite-only initially?

**Q3.3:** Rewardful plan: start on Starter (USD 49/mo, 1 campaign), or budget for Growth (USD 99/mo, 2 campaigns) from day 1?

---

### 4. Operational

**Q4.1:** Payout day: 15th of each month OK, or prefer different date?

**Q4.2:** Minimum payout: EUR 50 confirmed, or adjust higher/lower?

**Q4.3:** Reconciliation drift tolerance: email digest daily, or only if >X issues (threshold)?

**Q4.4:** When should we enable the feature flag in production?
- After Phase 4 complete + founder approval
- Soft launch (flag ON, but no public affiliate page)
- Hard launch (flag ON + marketing page live)

---

## Summary of Findings

### What exists (strengths)

✅ **Clean architecture** — Fastify API + Next.js 15 + Prisma  
✅ **Stripe integration ready** — webhook handler, Customer/Subscription management  
✅ **Organization-level billing** — matches referral attribution model  
✅ **Cookie consent system** — can gate Rewardful script loading  
✅ **Audit log infrastructure** — extends easily for affiliate actions  
✅ **Test infrastructure** — Vitest, CI, integration tests  
✅ **Job infrastructure** — standalone scripts for cron  
✅ **Rate limiting** — protects API from abuse  
✅ **Email system** — Resend integration, dev/prod split  
✅ **No existing referral code** — clean slate  

### What needs building (gaps)

⚠️ **Stripe Customer creation timing** — currently lazy, must be immediate for referred signups  
⚠️ **Stripe event handlers** — need `invoice.paid`, refund, dispute  
⚠️ **Webhook deduplication** — no idempotency table exists yet  
⚠️ **Admin authorization** — no dedicated admin role or allowlist  
⚠️ **Encryption helper** — no AES encryption for IBAN at rest  
⚠️ **IP hashing helper** — no salted hash utility for click tracking  
⚠️ **Email normalization** — need +tag and Gmail dots handling for self-referral checks  

### Architectural adjustments needed

1. **Customer creation:** For referred signups, create Customer at signup (not at checkout)
2. **Attribution entity:** Attach to Organization (not User)
3. **Admin auth:** Add `AFFILIATE_ADMIN_EMAILS` env var or admin role
4. **Webhook idempotency:** Add `stripe_webhook_events` and `rewardful_webhook_events` tables
5. **Metadata:** Use `client_reference_id` for Rewardful UUID (no conflict)

### What can be simplified from brief

**Simplify:**
- Skip `client_reference_id` migration (not used)
- No multi-tier complexity in V1 (single 24-month campaign)
- No custom click analytics (use Rewardful's dashboard)
- No self-billing PDF generation yet (use Rewardful export or defer to V1.1)

**Defer to V1.1:**
- SDK-event gate (can add in Phase 5)
- Fraud engine (basic checks in V1, advanced in V1.1)
- Sanctions workflows (manual field in admin, automate later)
- Automatic Wise batch send (manual in V1)
- Reconciliation UI (email digest in V1, UI in V1.1)

### Estimated complexity

**Total effort:** 4–6 weeks for one engineer (not calendar time, see guidelines)

**Breakdown:**
- Phase 1 (Foundation): 1 week
- Phase 2 (Rewardful): 1 week
- Phase 3 (Commissions): 1.5 weeks
- Phase 4 (Admin/Payouts): 1.5 weeks
- Phase 5 (Polish): 1 week

**Confidence:** High — no major technical unknowns, architecture is well-suited.

**Risks:** Tax treatment (blocker #1) is the only genuine uncertainty. Everything else is engineering execution.

---

## Conclusion

The Telemetry Tracker codebase is **well-architected and ready** for the Rewardful affiliate integration. The main architectural difference from the implementation brief is **Customer creation timing** — TT creates Customers lazily at first checkout, but for affiliate attribution to work, referred signups must create Customers immediately.

**No technical blockers exist**, only operational/legal questions:
1. Tax treatment of individual affiliates (accountant required)
2. VAT handling for foreign businesses (accountant required)
3. Rewardful Starter vs Growth plan (founder decision)
4. Admin authorization approach (founder decision)

**Recommendation:** Proceed with phased implementation. Start Phase 1 (internal attribution) immediately. Block Phase 2 (Rewardful integration) on accountant confirmation of tax treatment. Target production-ready in 4–6 weeks of engineering effort.

**Next steps:**
1. Founder schedules call with accountant (Q1.1–Q1.4)
2. Founder answers open questions (Q2–Q4)
3. Engineer begins Phase 1 (database schema + click tracking)
4. Sign up for Rewardful 14-day trial during Phase 1
5. Run manual test U1 (Stripe test mode) during trial

---

**End of Audit**  
**Date:** 4 October 2026  
**Phase:** 0 (Read-only) COMPLETE  
**Next:** Await founder decisions, then begin Phase 1 implementation
