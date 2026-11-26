-- CreateEnum
CREATE TYPE "PublicationSourceType" AS ENUM ('COMMUNITY', 'RESIDENT', 'OFFICIAL', 'EXTERNAL');

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "sourceName" VARCHAR(100),
ADD COLUMN     "sourceType" "PublicationSourceType" NOT NULL DEFAULT 'COMMUNITY',
ADD COLUMN     "sourceUrl" VARCHAR(2048),
ADD COLUMN     "videoUrl" VARCHAR(2048);

-- Preserve the origin of reader submissions that were already approved.
-- Sender names and contacts remain private and are never copied to a post.
UPDATE "Post"
SET "sourceType" = 'RESIDENT'
WHERE EXISTS (
    SELECT 1
    FROM "Submission"
    WHERE "Submission"."postId" = "Post"."id"
      AND "Submission"."status" = 'APPROVED'
);
