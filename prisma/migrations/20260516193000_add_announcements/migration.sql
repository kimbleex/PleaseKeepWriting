CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "title" TEXT NOT NULL,
    "tag" TEXT NOT NULL DEFAULT '系统公告',
    "summary" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" DATE NOT NULL,
    "readUserIds" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Announcement_publishedAt_idx" ON "Announcement"("publishedAt");
CREATE INDEX "Announcement_pinned_idx" ON "Announcement"("pinned");
