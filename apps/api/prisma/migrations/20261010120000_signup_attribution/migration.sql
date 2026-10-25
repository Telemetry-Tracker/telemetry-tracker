ALTER TABLE "User"
  ADD COLUMN "utm_source" VARCHAR(100),
  ADD COLUMN "utm_medium" VARCHAR(100),
  ADD COLUMN "utm_campaign" VARCHAR(100),
  ADD COLUMN "utm_content" VARCHAR(100),
  ADD COLUMN "utm_term" VARCHAR(100),
  ADD COLUMN "referrer_host" VARCHAR(253);
