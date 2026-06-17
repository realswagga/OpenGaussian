-- gsplat-platform PostgreSQL Schema
-- Generated from apps/api/prisma/schema.prisma
-- Import into PostgreSQL, then use DBeaver / DataGrip / pgAdmin ERD viewer

BEGIN;

-- ============================================================================
-- EXTENSIONS
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- ENUMS
-- ============================================================================
CREATE TYPE "UserRole" AS ENUM (
  'MASTER_ADMIN',
  'CLIENT',
  'ADMIN',
  'EDITOR',
  'VIEWER'
);

CREATE TYPE "OrganizationRole" AS ENUM (
  'MANAGER',
  'EDITOR'
);

CREATE TYPE "MembershipStatus" AS ENUM (
  'ACTIVE',
  'INVITED',
  'DISABLED'
);

CREATE TYPE "SplatStatus" AS ENUM (
  'DRAFT',
  'PROCESSING',
  'READY',
  'PUBLISHED',
  'FAILED',
  'ARCHIVED'
);

CREATE TYPE "ProcessingStatus" AS ENUM (
  'PENDING',
  'RUNNING',
  'READY',
  'FAILED'
);

-- ============================================================================
-- TABLES
-- ============================================================================

-- --------------------------------------------------------------------------
-- User
-- --------------------------------------------------------------------------
CREATE TABLE "User" (
  "id"           UUID        NOT NULL DEFAULT gen_random_uuid(),
  "email"        TEXT        NOT NULL,
  "name"         TEXT,
  "passwordHash" TEXT        NOT NULL,
  "role"         "UserRole"  NOT NULL DEFAULT 'CLIENT',
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "User_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "User_email_key" UNIQUE ("email")
);

-- --------------------------------------------------------------------------
-- Organization
-- --------------------------------------------------------------------------
CREATE TABLE "Organization" (
  "id"              UUID        NOT NULL DEFAULT gen_random_uuid(),
  "slug"            TEXT        NOT NULL,
  "name"            TEXT        NOT NULL,
  "description"     TEXT,
  "websiteUrl"      TEXT,
  "previewKey"      TEXT,
  "isPublic"        BOOLEAN     NOT NULL DEFAULT true,
  "createdByUserId" UUID,
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "Organization_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Organization_slug_key" UNIQUE ("slug"),
  CONSTRAINT "Organization_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

-- --------------------------------------------------------------------------
-- OrganizationMembership
-- --------------------------------------------------------------------------
CREATE TABLE "OrganizationMembership" (
  "id"               UUID               NOT NULL DEFAULT gen_random_uuid(),
  "organizationId"   UUID               NOT NULL,
  "userId"           UUID               NOT NULL,
  "role"             "OrganizationRole" NOT NULL,
  "status"           "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  "canCreateSplats"  BOOLEAN            NOT NULL DEFAULT false,
  "canUploadSplats"  BOOLEAN            NOT NULL DEFAULT false,
  "canEditSplats"    BOOLEAN            NOT NULL DEFAULT false,
  "canDeleteSplats"  BOOLEAN            NOT NULL DEFAULT false,
  "canPublishSplats" BOOLEAN            NOT NULL DEFAULT false,
  "canEditMarkers"   BOOLEAN            NOT NULL DEFAULT false,
  "invitedByUserId"  UUID,
  "createdAt"        TIMESTAMPTZ        NOT NULL DEFAULT now(),
  "updatedAt"        TIMESTAMPTZ        NOT NULL DEFAULT now(),

  CONSTRAINT "OrganizationMembership_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrganizationMembership_organizationId_userId_key"
    UNIQUE ("organizationId", "userId"),
  CONSTRAINT "OrganizationMembership_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OrganizationMembership_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OrganizationMembership_invitedByUserId_fkey"
    FOREIGN KEY ("invitedByUserId") REFERENCES "User" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "OrganizationMembership_userId_idx"
  ON "OrganizationMembership" ("userId");

CREATE INDEX "OrganizationMembership_organizationId_idx"
  ON "OrganizationMembership" ("organizationId");

-- --------------------------------------------------------------------------
-- Splat
-- --------------------------------------------------------------------------
CREATE TABLE "Splat" (
  "id"                  UUID          NOT NULL DEFAULT gen_random_uuid(),
  "slug"                TEXT          NOT NULL,
  "title"               TEXT          NOT NULL,
  "description"         TEXT,
  "status"              "SplatStatus" NOT NULL DEFAULT 'DRAFT',
  "organizationId"      UUID,
  "sourceFormat"        TEXT,
  "sourceObjectKey"     TEXT,
  "productionFormat"    TEXT,
  "productionObjectKey" TEXT,
  "lodManifestKey"      TEXT,
  "posterKey"           TEXT,
  "collisionKey"        TEXT,
  "splatCount"          INTEGER,
  "sizeBytes"           BIGINT,
  "boundingBoxJson"     JSONB,
  "defaultCameraJson"   JSONB,
  "globalSettingsJson"  JSONB,
  "servingVersionId"    UUID,
  "createdAt"           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  "pretransformJson"    JSONB,
  "updatedAt"           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  "publishedAt"         TIMESTAMPTZ,

  CONSTRAINT "Splat_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Splat_slug_key" UNIQUE ("slug"),
  CONSTRAINT "Splat_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "Splat_organizationId_idx" ON "Splat" ("organizationId");
CREATE INDEX "Splat_servingVersionId_idx" ON "Splat" ("servingVersionId");

-- --------------------------------------------------------------------------
-- SplatVersion
-- --------------------------------------------------------------------------
CREATE TABLE "SplatVersion" (
  "id"                UUID               NOT NULL DEFAULT gen_random_uuid(),
  "splatId"           UUID               NOT NULL,
  "version"           INTEGER            NOT NULL,
  "sourceKey"         TEXT               NOT NULL,
  "convertedKey"      TEXT,
  "lodKey"            TEXT,
  "posterKey"         TEXT,
  "productionFormat"  TEXT,
  "splatCount"        INTEGER,
  "sizeBytes"         BIGINT,
  "boundingBoxJson"   JSONB,
  "defaultCameraJson"  JSONB,
  "globalSettingsJson" JSONB,
  "pretransformJson"  JSONB,
  "settingsKey"       TEXT,
  "processingStatus"  "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
  "processingLog"     TEXT,
  "metricsJson"       JSONB,
  "createdAt"         TIMESTAMPTZ        NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMPTZ        NOT NULL DEFAULT now(),

  CONSTRAINT "SplatVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SplatVersion_splatId_version_key"
    UNIQUE ("splatId", "version"),
  CONSTRAINT "SplatVersion_splatId_fkey"
    FOREIGN KEY ("splatId") REFERENCES "Splat" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "SplatVersion_splatId_idx" ON "SplatVersion" ("splatId");

-- Add the servingVersion FK on Splat (deferred — refers to SplatVersion)
ALTER TABLE "Splat"
  ADD CONSTRAINT "Splat_servingVersionId_fkey"
    FOREIGN KEY ("servingVersionId") REFERENCES "SplatVersion" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- --------------------------------------------------------------------------
-- Annotation
-- --------------------------------------------------------------------------
CREATE TABLE "Annotation" (
  "id"                  UUID        NOT NULL DEFAULT gen_random_uuid(),
  "splatId"             UUID        NOT NULL,
  "versionId"           UUID,
  "title"               TEXT        NOT NULL,
  "body"                TEXT,
  "kind"                TEXT        NOT NULL DEFAULT 'info',
  "positionX"           DOUBLE PRECISION NOT NULL,
  "positionY"           DOUBLE PRECISION NOT NULL,
  "positionZ"           DOUBLE PRECISION NOT NULL,
  "rotationX"           DOUBLE PRECISION NOT NULL DEFAULT 0,
  "rotationY"           DOUBLE PRECISION NOT NULL DEFAULT 0,
  "rotationZ"           DOUBLE PRECISION NOT NULL DEFAULT 0,
  "scale"               DOUBLE PRECISION NOT NULL DEFAULT 1,
  "icon"                TEXT,
  "color"               TEXT,
  "visibilityRulesJson" JSONB,
  "mediaJson"           JSONB,
  "createdAt"           TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "Annotation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Annotation_splatId_fkey"
    FOREIGN KEY ("splatId") REFERENCES "Splat" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Annotation_versionId_fkey"
    FOREIGN KEY ("versionId") REFERENCES "SplatVersion" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Annotation_splatId_versionId_idx"
  ON "Annotation" ("splatId", "versionId");

-- --------------------------------------------------------------------------
-- ViewerPreset
-- --------------------------------------------------------------------------
CREATE TABLE "ViewerPreset" (
  "id"               UUID        NOT NULL DEFAULT gen_random_uuid(),
  "splatId"          UUID        NOT NULL,
  "name"             TEXT        NOT NULL,
  "cameraMode"       TEXT        NOT NULL DEFAULT 'orbit',
  "lodBudget"        INTEGER     NOT NULL DEFAULT 1500000,
  "mobileLodBudget"  INTEGER     NOT NULL DEFAULT 500000,
  "vrLodBudget"      INTEGER     NOT NULL DEFAULT 60000,
  "enableVr"         BOOLEAN     NOT NULL DEFAULT true,
  "enableWebGpu"     BOOLEAN     NOT NULL DEFAULT true,
  "enableMarkers"    BOOLEAN     NOT NULL DEFAULT true,
  "lockScene"        BOOLEAN     NOT NULL DEFAULT false,
  "allowFly"         BOOLEAN     NOT NULL DEFAULT true,
  "allowOrbit"       BOOLEAN     NOT NULL DEFAULT true,
  "settingsJson"     JSONB,
  "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "ViewerPreset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ViewerPreset_splatId_fkey"
    FOREIGN KEY ("splatId") REFERENCES "Splat" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- --------------------------------------------------------------------------
-- AppSetting
-- --------------------------------------------------------------------------
CREATE TABLE "AppSetting" (
  "key"       TEXT        NOT NULL,
  "value"     JSONB,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- ============================================================================
-- updatedAt AUTO-TRIGGERS
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_User_updatedAt
  BEFORE UPDATE ON "User"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_Organization_updatedAt
  BEFORE UPDATE ON "Organization"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_OrganizationMembership_updatedAt
  BEFORE UPDATE ON "OrganizationMembership"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_Splat_updatedAt
  BEFORE UPDATE ON "Splat"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_SplatVersion_updatedAt
  BEFORE UPDATE ON "SplatVersion"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_Annotation_updatedAt
  BEFORE UPDATE ON "Annotation"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_ViewerPreset_updatedAt
  BEFORE UPDATE ON "ViewerPreset"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_AppSetting_updatedAt
  BEFORE UPDATE ON "AppSetting"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
