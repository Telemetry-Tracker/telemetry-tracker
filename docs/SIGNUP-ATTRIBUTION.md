# First-touch signup attribution

New users have nullable `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`,
`utm_term` (VARCHAR(100)) and `referrer_host` (VARCHAR(253)) columns. The migration
adds nullable columns without defaults or historical backfills. Missing, direct,
invalid and consent-declined UTM/referrer values are SQL NULL. A consented direct
landing is remembered even without UTM/referrer values, so later campaigns cannot
replace it. The funnel extension below distinguishes channel and landing path.

The root dashboard layout also serves the marketing site. It captures the initial
landing's UTM parameters and document referrer in component memory. Attribution
supports marketing analysis rather than a necessary signup function, so we use
the stricter consent interpretation: no attribution cookie before accepted cookie
consent. Acceptance stores the remembered first landing in the first-party
`tt_signup_attribution` cookie for 60 days (SameSite=Lax, Secure on HTTPS).
On telemetry-tracker.com the cookie is scoped to that domain and its subdomains;
other deployments use a host-only cookie. Existing values are never refreshed or
overwritten while the cookie remains valid. Rejection deletes the cookie and
prevents forwarding. The server action independently checks its authoritative
consent cookie. The affiliate consent setup is unchanged.

Without consent, landing values exist only in the mounted component's memory;
a full reload or navigation to another origin before acceptance loses them.
Each host still uses the existing host-specific consent choice: visitors must
accept on the signup host before it can forward a shared attribution cookie.
Cookie expiry, deletion or a new browser starts a new observable first touch.
Storage failures yield missing attribution and never block signup.

Registration passes a separate optional `signupAttribution` object through the
form and server action to the API. Both self-serve email/password signup and
invite signup save sanitized fields in the user creation operation (inside the
invite transaction). There is currently no OAuth signup implementation. Login,
invite acceptance by existing users and subsequent visits do not update users.
The public API accepts optional client-supplied attribution; it is not verified
marketing evidence and can be spoofed. Direct API clients must obtain appropriate
consent themselves; the API has no browser consent state.

UTM values are trimmed, restricted to ASCII letters, digits, spaces, underscore,
dot and hyphen, and truncated to 100 characters. Referrers accept HTTP(S), keep
only a lowercase hostname, and discard paths, queries, fragments, credentials and
ports. telemetry-tracker.com and every subdomain are ignored. No additional
personal fields or full referring URLs are stored. Tags should not contain PII.

Affiliate `ref`/`via`, sessionStorage, optional referral cookie, last-touch timing,
user/organization attribution and invite behavior are unchanged. Separate tests
cover simultaneous campaign and affiliate capture.

Example daily signup aggregation (Prisma stores `created_at` as UTC; NULL UTM fields include direct, missing and
consent-declined traffic; use signup_channel for the coarse distinction):

```sql
SELECT created_at::date AS signup_day,
       utm_source, utm_campaign, count(*) AS signups
FROM "User"
GROUP BY 1, 2, 3
ORDER BY 1 DESC, 4 DESC;
```

## Privacy disclosure

The public privacy policy (`/privacy`, "What we collect" table, row "Signup attribution")
and cookie policy (`/cookies`, `tt_signup_attribution`) disclose what is collected (UTM tags
and referrer hostname), why (aggregate acquisition analysis), that it requires accepted
cookie consent, and retention (cookie up to 60 days; then stored on the user record until
the account is deleted). Update both pages if the fields, purpose or retention change.

## Durable signup funnel extension

New nullable User columns: `signup_channel` (VARCHAR(32)) and
`first_landing_path` (VARCHAR(2048)). The first-touch cookie includes both fields
under the same consent and 60-day lifetime rules. Landing paths discard fragments
and every query parameter except sanitized `utm_source`, `utm_medium`, and
`utm_campaign`. Existing content/term fields remain for compatibility. Avoid PII
in campaign tags or URL paths. No IP, user agent or fingerprint is added.

Channel is computed from sanitized campaign medium/source and exact referrer
hosts (including subdomains): `organic_search`, `ai_assistant`, `social`,
`referral`, or `unknown` (including direct/unclassified traffic). Missing
attribution at API registration records `no_consent` with null attribution;
this also includes clients that omit attribution and is not proof of refusal.
Historical users remain null; old cookies without a path remain valid.

After successful email/password or invite registration, the client emits one GA4
`sign_up` event with `method: email` before navigation, only if the existing
consent choice is accepted and the existing `gtag` function is available. Failed
registration emits nothing. No new GA loader, identifier or other event is added.
If GA has not loaded or is blocked, the event is omitted rather than persisted.
Configure GA4 sign_up as a key event separately when deploying.

Project `first_event_at` is an atomic set-once server receipt timestamp after an
accepted event, nonempty batch, new session or error. Invalid, quota-rejected and
empty payloads do not activate projects. Session updates do not create new
telemetry. A conditional null update costs one indexed project lookup per accepted
request (one per batch); it cannot overwrite a prior timestamp, even concurrently.
Raw retention never updates this column. Organization activation can be derived
as min(Project.first_event_at); no duplicate organization/user fact is needed.

The additive migration backfills the earliest surviving Event.created_at,
ErrorOccurrence.created_at (through ErrorGroup) or Session.started_at. If none
survive, min(ApiKey.last_used_at) is an approximate fallback: it can include
non-ingest authentication and represents last use, not necessarily first use.
Retention already applied before migration means historical first touch cannot
be reconstructed exactly. Historical session times are client-provided; new
receipt timestamps use the server clock. All columns remain nullable.
The backfill scans surviving data and updates project rows; schedule it according
to database size and normal migration procedures. No migration was run here.

A pg_roles-guarded DO block grants analytics_ro column SELECT only on the new
User and Project columns when the role exists. It leaves existing grants intact.
No public reporting endpoint or database view is added. Read-only reporting can
use existing User.created_at for signups, Project.created_at for project creation,
and Project.first_event_at for activation, grouped by UTC date. GA4 provides
consented landing traffic; the server facts include all registrations/telemetry,
so these populations differ and do not form a person-level visitor join.

Example daily stage totals (independent UTC day counts, not conversion cohorts):

```sql
SELECT created_at::date AS day, 'signup' AS stage, count(*) AS total
FROM "User" GROUP BY 1
UNION ALL
SELECT created_at::date, 'project_created', count(*)
FROM "Project" GROUP BY 1
UNION ALL
SELECT first_event_at::date, 'first_telemetry', count(*)
FROM "Project" WHERE first_event_at IS NOT NULL GROUP BY 1
ORDER BY day DESC, stage;
```

Counts include invited users and soft-deleted projects; add appropriate filters
when defining the founder's report. These counts are operational stages, not
proof that the same visitor progressed through every stage.
