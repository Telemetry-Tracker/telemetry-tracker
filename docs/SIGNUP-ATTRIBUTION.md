# First-touch signup attribution

New users have nullable `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`,
`utm_term` (VARCHAR(100)) and `referrer_host` (VARCHAR(253)) columns. The migration
adds nullable columns without defaults or historical backfills. Missing, direct,
invalid and consent-declined values are SQL NULL. A consented direct landing is
remembered as an all-null object, so later campaigns cannot replace it.

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
consent cookie. GA and the affiliate consent setup are unchanged.

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

Example daily signup aggregation (Prisma stores `created_at` as UTC; NULL includes direct, missing and
consent-declined traffic, which cannot be distinguished):

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
