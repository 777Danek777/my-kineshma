CREATE TABLE "SiteSettings" (
  "id" TEXT NOT NULL DEFAULT 'main',
  "commentsModerationEnabled" BOOLEAN NOT NULL DEFAULT false,
  "postsModerationEnabled" BOOLEAN NOT NULL DEFAULT true,
  "defaultCategoryId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SiteSettings_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "SiteSettings" ADD CONSTRAINT "SiteSettings_defaultCategoryId_fkey" FOREIGN KEY ("defaultCategoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
INSERT INTO "SiteSettings" ("id", "defaultCategoryId") VALUES ('main', (SELECT "id" FROM "Category" ORDER BY CASE WHEN "name"='Город' THEN 0 ELSE 1 END, "name" LIMIT 1));
CREATE TYPE "MediaKind" AS ENUM ('IMAGE', 'VIDEO');
ALTER TABLE "MediaAsset" ADD COLUMN "kind" "MediaKind" NOT NULL DEFAULT 'IMAGE', ADD COLUMN "mimeType" TEXT NOT NULL DEFAULT 'image/webp', ADD COLUMN "duration" DOUBLE PRECISION;
ALTER TABLE "Post" ALTER COLUMN "authorId" DROP NOT NULL;
ALTER TABLE "Post" ADD COLUMN "publicAuthorName" VARCHAR(60);
ALTER TABLE "Submission" ADD COLUMN "publicAuthorName" VARCHAR(60);
ALTER TABLE "SubmissionReceipt" ADD COLUMN "acceptedStatus" "SubmissionStatus" NOT NULL DEFAULT 'PENDING', ADD COLUMN "publishedSlug" TEXT;
-- Preserve the original acceptance result for old retries; no queued material is auto-approved.
ALTER TABLE "CommentReceipt" ADD COLUMN "acceptedStatus" "CommentStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "Comment" ADD COLUMN "parentId" TEXT;
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Comment_parentId_status_createdAt_id_idx" ON "Comment"("parentId", "status", "createdAt", "id");
CREATE TABLE "CommentLike" (
  "id" TEXT NOT NULL,
  "commentId" TEXT NOT NULL,
  "anonymousVisitorIdHash" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommentLike_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CommentLike_commentId_anonymousVisitorIdHash_key" ON "CommentLike"("commentId", "anonymousVisitorIdHash");
ALTER TABLE "CommentLike" ADD CONSTRAINT "CommentLike_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
