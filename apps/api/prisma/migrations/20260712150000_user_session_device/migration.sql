-- Dashboard auth session device hints (#357)
ALTER TABLE "UserSession" ADD COLUMN "user_agent" TEXT;
ALTER TABLE "UserSession" ADD COLUMN "device_browser" TEXT;
ALTER TABLE "UserSession" ADD COLUMN "device_os" TEXT;
