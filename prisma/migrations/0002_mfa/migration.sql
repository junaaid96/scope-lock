-- AlterTable: TOTP multi-factor authentication on User
ALTER TABLE "User" ADD COLUMN "totpSecretEnc" TEXT,
  ADD COLUMN "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "mfaRecoveryHashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
