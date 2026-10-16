# Aggregated signup statistics

`GET /api/signup-stats?start=2026-10-01&end=2026-10-12` is a read-only API
endpoint, independently authenticated with `Authorization: Bearer <SIGNUP_STATS_TOKEN>`.
Use HTTPS and a high-entropy secret (e.g. `openssl rand -hex 32`). Keep the secret
server-side; never put it in dashboard/public environment variables or URLs.
An unset or empty token returns **404**. Missing/wrong credentials return **401**;
user sessions and project API keys grant no access. SHA-256 digests are compared
with `crypto.timingSafeEqual`. Configuration is read when the app starts; restart
for token rotation or label changes. Responses set `Cache-Control: no-store`.
The route is limited to 30 requests per minute per client IP, including failed
authentication. This uses the API's socket IP policy and an in-process limiter;
replicas have independent limits, and a shared proxy IP shares its allowance.

## Range and response

`start` and `end` are strict calendar dates `YYYY-MM-DD`, both inclusive, in UTC.
The maximum is 366 days inclusive. Invalid dates, repeated/unknown parameters,
reversed ranges and longer ranges return 400. With no parameters the range is
the last 30 UTC days including today. An omitted end defaults to today; an omitted
start defaults to 29 days before end. Today/future dates are permitted and may be
partial/empty. The database filter uses an exclusive next-day upper bound.

The response contains `range`, total `signups`, total `affiliateSignups`, `daily`,
`weekly`, `acquisition`, `conversions` and `conversionNote`. Daily entries contain
`date`, `signups`, `affiliateSignups`, including zero days. Weekly entries contain
`weekStart` (Monday UTC, ISO week convention), `signups`, `affiliateSignups`.
Boundary weeks contain only days within the requested range, not entire weeks.
`acquisition` groups the whole range jointly by `source`, `medium`, `campaign`,
`referrer` (hostname), with signup and affiliate counts. Each user contributes
once, including invite registrations; these are account signups, not org counts.

Attribution reads stored first-touch fields only. SQL NULL becomes `unattributed`
(including historical, direct, missing and consent-declined signups); there is no
backfill or inference. Affiliate counts require an existing `UserReferral` with
`ACTIVE` status and a bound affiliate. EXPIRED, REJECTED and UNRESOLVED referrals
are excluded, independently of current feature flags or affiliate enabled state.
No affiliate codes or identifying records are returned.

`conversions` is **null**: mutable current organization plan/subscription fields
cannot establish historical free-to-paid transitions or unique user signup-cohort
ownership. Multiple memberships, paid-org invites, cancellations and self-hosted
plans make a cohort/source conversion count unreliable. The response explains this;
no current-plan proxy is reported as a conversion.

## Privacy and approved labels

Acquisition tags are untrusted client input and can contain names or other personal
data despite signup sanitization. To prevent reflecting such values, only exact
operator-approved, non-personal labels are returned. Configure comma-separated
`SIGNUP_STATS_SOURCES`, `SIGNUP_STATS_MEDIUMS`, `SIGNUP_STATS_CAMPAIGNS` and
`SIGNUP_STATS_REFERRERS` on the API. Unapproved non-null values become `redacted`
and are reaggregated; defaults approve no labels. Null stays `unattributed`.
For example, approve `newsletter` as a source, `email` as a medium, `launch` as a
campaign and `search.example` as a referrer. Approve only generic marketing labels
and public acquisition hostnames; never approve names, email addresses, IDs or IPs.
Reserve `unattributed` and `redacted` for the endpoint's sentinel values.

No email, display name, user/org/affiliate ID, IP, URL, individual referral row or
personal column is selected into the response. Counts are aggregated in Postgres.
Small counts are retained because access is restricted to a dedicated operator
secret and labels are explicitly approved. This is private operational analytics,
not a public anonymous dataset: do not publish its output. Deleted users disappear
from these live counts. No schema changes, writes or external billing calls occur.

## Verification

`pnpm --filter api test -- src/routes/signup-stats.test.ts` exercises authentication,
range limits, parameterized read-only queries, UTC/ISO boundaries, empty buckets,
aggregation, label privacy, affiliate filtering and rate limiting with mocked DB
aggregates. It does not require or touch a production database.
