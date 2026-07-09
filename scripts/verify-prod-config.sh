#!/usr/bin/env bash
# Production deployment checklist verifier (#85) — external checks only.
# Verifies public API/dashboard behavior that implies correct Railway env vars.
# Does not need Railway dashboard access; cannot confirm migrate deploy or cron.
set -euo pipefail

API="${VERIFY_API_URL:-https://api.telemetry-tracker.com}"
DASH="${VERIFY_DASHBOARD_URL:-https://telemetry-tracker.com}"

pass=0
fail=0
warn=0

log() { printf '%s\n' "$*"; }
ok() { pass=$((pass + 1)); log "  PASS: $1"; }
bad() { fail=$((fail + 1)); log "  FAIL: $1"; }
warn_step() { warn=$((warn + 1)); log "  WARN: $1"; }

http_code() {
  curl -sS -o /dev/null -w '%{http_code}' "$@" 2>/dev/null || echo "000"
}

log "=== Production config verification (#85) ==="
log "API: $API"
log "Dashboard: $DASH"
log ""

# --- TLS ---
log "1. TLS / HTTPS"
if [[ "$API" == https://* ]]; then ok "API URL uses HTTPS"; else bad "API URL must use HTTPS"; fi
if [[ "$DASH" == https://* ]]; then ok "Dashboard URL uses HTTPS"; else bad "Dashboard URL must use HTTPS"; fi
log ""

# --- Health (HEALTH_CHECK_DATABASE=true) ---
log "2. API health (implies HEALTH_CHECK_DATABASE=true)"
HEALTH_CODE=$(http_code "$API/health")
HEALTH=$(curl -sS "$API/health" 2>/dev/null || true)
if [[ "$HEALTH_CODE" == "000" || -z "$HEALTH" ]]; then
  bad "GET /health unreachable"
elif [[ "$HEALTH_CODE" == "503" ]]; then
  bad "GET /health → 503 (database unavailable?) — $HEALTH"
else
  if echo "$HEALTH" | grep -q '"ok":true'; then ok "GET /health ok:true"; else bad "GET /health ok:false — $HEALTH"; fi
  if echo "$HEALTH" | grep -q '"database":"ok"'; then
    ok "database probe ok (HEALTH_CHECK_DATABASE=true)"
  else
    bad "missing database:ok — set HEALTH_CHECK_DATABASE=true on API"
  fi
  if echo "$HEALTH" | grep -q '"database_latency_ms"'; then
    ok "database_latency_ms present"
  else
    bad "missing database_latency_ms"
  fi
  if echo "$HEALTH" | grep -q '"version"'; then ok "version field present"; else warn_step "missing version in /health"; fi
  if echo "$HEALTH" | grep -q '"email":"configured"'; then
    ok "transactional email configured (Resend)"
  elif echo "$HEALTH" | grep -q '"email":"not_configured"'; then
    warn_step "email not configured (set RESEND_API_KEY + TELEMETRY_EMAIL_FROM)"
  fi
fi
log ""

# --- Ingest auth (INGEST_ALLOW_UNAUTHENTICATED off) ---
log "3. Ingest auth (INGEST_ALLOW_UNAUTHENTICATED must be off)"
INGEST_CODE=$(http_code -X POST "$API/ingest/event" -H 'Content-Type: application/json' -d '{}')
if [[ "$INGEST_CODE" == "401" ]]; then
  ok "POST /ingest/event without key → 401"
else
  bad "POST /ingest/event without key → $INGEST_CODE (expected 401)"
fi
log ""

# --- Read auth (NODE_ENV=production, no TELEMETRY_ALLOW_UNAUTHENTICATED_READS) ---
log "4. Dashboard read auth (production session required)"
READ_CODE=$(http_code "$API/api/errors")
if [[ "$READ_CODE" == "401" ]]; then
  ok "GET /api/errors without session → 401"
else
  bad "GET /api/errors without session → $READ_CODE (expected 401; check NODE_ENV=production and unset TELEMETRY_ALLOW_UNAUTHENTICATED_READS)"
fi
log ""

# --- CORS (CORS_ORIGINS / DASHBOARD_ORIGIN) ---
log "5. CORS for dashboard origin"
CORS_HEADERS=$(curl -sS -D - -o /dev/null -X OPTIONS "$API/api/meta/session-context" \
  -H "Origin: $DASH" \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization,content-type' 2>/dev/null || true)
if echo "$CORS_HEADERS" | grep -qi "access-control-allow-origin:.*$(echo "$DASH" | sed 's|https://||')"; then
  ok "CORS preflight allows dashboard origin"
elif echo "$CORS_HEADERS" | grep -qi "access-control-allow-origin: $DASH"; then
  ok "CORS preflight allows dashboard origin"
else
  bad "CORS preflight missing Access-Control-Allow-Origin for $DASH — set CORS_ORIGINS or DASHBOARD_ORIGIN"
fi

CORS_BAD_CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X OPTIONS "$API/api/meta/session-context" \
  -H 'Origin: https://evil.example.com' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization' 2>/dev/null || echo "000")
if [[ "$CORS_BAD_CODE" == "404" ]]; then
  ok "CORS rejects unknown origin (production mode)"
else
  bad "CORS unknown origin → $CORS_BAD_CODE (expected 404 in production)"
fi
log ""

# --- Dashboard reachability (API_URL / NEXT_PUBLIC_SITE_URL on dashboard service) ---
log "6. Dashboard reachability"
DASH_CODE=$(http_code "$DASH")
if [[ "$DASH_CODE" == "200" ]]; then ok "Dashboard home → 200"; else bad "Dashboard home → $DASH_CODE"; fi
LOGIN_CODE=$(http_code "$DASH/login")
if [[ "$LOGIN_CODE" == "200" ]]; then ok "/login → 200"; else bad "/login → $LOGIN_CODE"; fi
log ""

log "=== Summary ==="
log "PASS: $pass  FAIL: $fail  WARN: $warn"
log ""
log "Manual Railway checks (not covered by this script):"
log "  - API env: NODE_ENV=production, TELEMETRY_DASHBOARD_ORIGIN=$DASH"
log "  - Dashboard env: API_URL=$API, NEXT_PUBLIC_SITE_URL=$DASH"
log "  - prisma migrate deploy on production database"
log "  - Retention cron scheduled (see docs/RAILWAY.md#retention-cron)"
log "  - Postgres backups enabled (see docs/RAILWAY.md#postgresql-backups-and-restore)"
log ""
log "Full E2E flow (register, ingest, billing): scripts/smoke-production.sh"

if [[ "$fail" -gt 0 ]]; then exit 1; fi
