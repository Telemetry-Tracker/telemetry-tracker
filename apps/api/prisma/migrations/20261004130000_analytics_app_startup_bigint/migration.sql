-- Widen startup marks to bigint so native monotonic clocks above 9,999,999
-- remain readable. Prisma applies this file as one transaction.
DROP VIEW public.analytics_app_startup;

CREATE VIEW public.analytics_app_startup
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  e.project_id,
  e.app,
  e.created_at,
  e.platform,
  e.sdk_version,
  e.environment,
  CASE
    WHEN jsonb_typeof(e.properties -> 'startup_path') = 'string'
     AND (e.properties ->> 'startup_path') IN (
       'cold_start_session',
       'cold_start_guest',
       'cold_start_guest_replace',
       'fresh_guest',
       'account_switch',
       'sign_in',
       'unknown'
     )
    THEN e.properties ->> 'startup_path'
    ELSE NULL
  END AS startup_path,
  CASE
    WHEN jsonb_typeof(e.properties -> 'startup_complete') = 'boolean'
    THEN (e.properties ->> 'startup_complete')::boolean
    ELSE NULL
  END AS startup_complete,
  CASE
    WHEN jsonb_typeof(e.properties -> 'startup_incomplete_reason') = 'string'
     AND (e.properties ->> 'startup_incomplete_reason') IN (
       'left_before_send',
       'ended_before_splash'
     )
    THEN e.properties ->> 'startup_incomplete_reason'
    ELSE NULL
  END AS startup_incomplete_reason,
  CASE
    WHEN jsonb_typeof(e.properties -> 'app_version') = 'string'
     AND (e.properties ->> 'app_version') ~ '^[A-Za-z0-9._+-]{1,32}$'
    THEN e.properties ->> 'app_version'
    ELSE NULL
  END AS app_version,
  CASE
    WHEN jsonb_typeof(e.properties -> 'build_number') = 'string'
     AND (e.properties ->> 'build_number') ~ '^[A-Za-z0-9._+-]{1,32}$'
    THEN e.properties ->> 'build_number'
    ELSE NULL
  END AS build_number,
  CASE
    WHEN jsonb_typeof(e.properties -> 'token_refresh') = 'boolean'
    THEN (e.properties ->> 'token_refresh')::boolean
    ELSE NULL
  END AS token_refresh,
  CASE
    WHEN jsonb_typeof(e.properties -> 'profile_cache') = 'boolean'
    THEN (e.properties ->> 'profile_cache')::boolean
    ELSE NULL
  END AS profile_cache,
  CASE
    WHEN jsonb_typeof(e.properties -> 'rollover_ran') = 'boolean'
    THEN (e.properties ->> 'rollover_ran')::boolean
    ELSE NULL
  END AS rollover_ran,
  CASE
    WHEN jsonb_typeof(e.properties -> 'js_startup_ms') = 'number'
     AND (e.properties ->> 'js_startup_ms') ~ '^[0-9]{1,18}$'
    THEN (e.properties ->> 'js_startup_ms')::bigint
    ELSE NULL
  END AS js_startup_ms,
  CASE
    WHEN jsonb_typeof(e.properties -> 'auth_bootstrap_start_ms') = 'number'
     AND (e.properties ->> 'auth_bootstrap_start_ms') ~ '^[0-9]{1,18}$'
    THEN (e.properties ->> 'auth_bootstrap_start_ms')::bigint
    ELSE NULL
  END AS auth_bootstrap_start_ms,
  CASE
    WHEN jsonb_typeof(e.properties -> 'auth_bootstrap_end_ms') = 'number'
     AND (e.properties ->> 'auth_bootstrap_end_ms') ~ '^[0-9]{1,18}$'
    THEN (e.properties ->> 'auth_bootstrap_end_ms')::bigint
    ELSE NULL
  END AS auth_bootstrap_end_ms,
  CASE
    WHEN jsonb_typeof(e.properties -> 'profile_ready_ms') = 'number'
     AND (e.properties ->> 'profile_ready_ms') ~ '^[0-9]{1,18}$'
    THEN (e.properties ->> 'profile_ready_ms')::bigint
    ELSE NULL
  END AS profile_ready_ms,
  CASE
    WHEN jsonb_typeof(e.properties -> 'rollover_start_ms') = 'number'
     AND (e.properties ->> 'rollover_start_ms') ~ '^[0-9]{1,18}$'
    THEN (e.properties ->> 'rollover_start_ms')::bigint
    ELSE NULL
  END AS rollover_start_ms,
  CASE
    WHEN jsonb_typeof(e.properties -> 'rollover_end_ms') = 'number'
     AND (e.properties ->> 'rollover_end_ms') ~ '^[0-9]{1,18}$'
    THEN (e.properties ->> 'rollover_end_ms')::bigint
    ELSE NULL
  END AS rollover_end_ms,
  CASE
    WHEN jsonb_typeof(e.properties -> 'letters_ready_ms') = 'number'
     AND (e.properties ->> 'letters_ready_ms') ~ '^[0-9]{1,18}$'
    THEN (e.properties ->> 'letters_ready_ms')::bigint
    ELSE NULL
  END AS letters_ready_ms,
  CASE
    WHEN jsonb_typeof(e.properties -> 'daily_goals_ready_ms') = 'number'
     AND (e.properties ->> 'daily_goals_ready_ms') ~ '^[0-9]{1,18}$'
    THEN (e.properties ->> 'daily_goals_ready_ms')::bigint
    ELSE NULL
  END AS daily_goals_ready_ms,
  CASE
    WHEN jsonb_typeof(e.properties -> 'game_state_ready_ms') = 'number'
     AND (e.properties ->> 'game_state_ready_ms') ~ '^[0-9]{1,18}$'
    THEN (e.properties ->> 'game_state_ready_ms')::bigint
    ELSE NULL
  END AS game_state_ready_ms,
  CASE
    WHEN jsonb_typeof(e.properties -> 'bootstrap_ready_ms') = 'number'
     AND (e.properties ->> 'bootstrap_ready_ms') ~ '^[0-9]{1,18}$'
    THEN (e.properties ->> 'bootstrap_ready_ms')::bigint
    ELSE NULL
  END AS bootstrap_ready_ms,
  CASE
    WHEN jsonb_typeof(e.properties -> 'shell_ready_ms') = 'number'
     AND (e.properties ->> 'shell_ready_ms') ~ '^[0-9]{1,18}$'
    THEN (e.properties ->> 'shell_ready_ms')::bigint
    ELSE NULL
  END AS shell_ready_ms,
  CASE
    WHEN jsonb_typeof(e.properties -> 'splash_hidden_ms') = 'number'
     AND (e.properties ->> 'splash_hidden_ms') ~ '^[0-9]{1,18}$'
    THEN (e.properties ->> 'splash_hidden_ms')::bigint
    ELSE NULL
  END AS splash_hidden_ms,
  CASE
    WHEN jsonb_typeof(e.properties -> 'first_interaction_ms') = 'number'
     AND (e.properties ->> 'first_interaction_ms') ~ '^[0-9]{1,18}$'
    THEN (e.properties ->> 'first_interaction_ms')::bigint
    ELSE NULL
  END AS first_interaction_ms,
  CASE
    WHEN jsonb_typeof(e.properties -> 'first_word_submit_ms') = 'number'
     AND (e.properties ->> 'first_word_submit_ms') ~ '^[0-9]{1,18}$'
    THEN (e.properties ->> 'first_word_submit_ms')::bigint
    ELSE NULL
  END AS first_word_submit_ms,
  CASE
    WHEN jsonb_typeof(e.properties -> 'dictionary_parse_ms') = 'number'
     AND (e.properties ->> 'dictionary_parse_ms') ~ '^[0-9]{1,18}$'
    THEN (e.properties ->> 'dictionary_parse_ms')::bigint
    ELSE NULL
  END AS dictionary_parse_ms,
  CASE
    WHEN jsonb_typeof(e.properties -> 'dictionary_wait_ms') = 'number'
     AND (e.properties ->> 'dictionary_wait_ms') ~ '^[0-9]{1,18}$'
    THEN (e.properties ->> 'dictionary_wait_ms')::bigint
    ELSE NULL
  END AS dictionary_wait_ms
FROM "Event" e
WHERE e.name = 'app_startup'
  AND e.app = 'besedna-igra';

REVOKE ALL ON TABLE public.analytics_app_startup FROM PUBLIC;

-- The role is provisioned outside migrations. CI databases do not have it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analytics_ro') THEN
    GRANT SELECT ON TABLE public.analytics_app_startup TO analytics_ro;
  END IF;
END $$;
