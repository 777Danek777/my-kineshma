CREATE TYPE "CommentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TABLE "Like" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "anonymousVisitorIdHash" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Like_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Like_postId_anonymousVisitorIdHash_key" ON "Like"("postId", "anonymousVisitorIdHash");
ALTER TABLE "Like" ADD CONSTRAINT "Like_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CommentReceipt" (
  "key" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommentReceipt_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "CommentReceipt_postId_idx" ON "CommentReceipt"("postId");
CREATE INDEX "CommentReceipt_createdAt_idx" ON "CommentReceipt"("createdAt");
ALTER TABLE "CommentReceipt" ADD CONSTRAINT "CommentReceipt_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Comment" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "displayName" VARCHAR(60) NOT NULL,
  "content" VARCHAR(2000) NOT NULL,
  "status" "CommentStatus" NOT NULL DEFAULT 'PENDING',
  "version" INTEGER NOT NULL DEFAULT 1,
  "receiptKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Comment_receiptKey_key" ON "Comment"("receiptKey");
CREATE INDEX "Comment_postId_status_createdAt_id_idx" ON "Comment"("postId", "status", "createdAt", "id");
CREATE INDEX "Comment_status_createdAt_id_idx" ON "Comment"("status", "createdAt", "id");
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_receiptKey_fkey" FOREIGN KEY ("receiptKey") REFERENCES "CommentReceipt"("key") ON DELETE CASCADE ON UPDATE CASCADE;
