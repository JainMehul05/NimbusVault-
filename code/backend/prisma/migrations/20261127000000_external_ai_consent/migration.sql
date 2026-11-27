-- Additive, default off: existing users keep private local AI until they opt in.
ALTER TABLE "users" ADD COLUMN "externalAiConsent" BOOLEAN NOT NULL DEFAULT false;
