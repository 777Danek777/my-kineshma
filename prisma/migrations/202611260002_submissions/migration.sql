-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "MediaAsset" ALTER COLUMN "uploadedById" DROP NOT NULL;

-- CreateTable
CREATE TABLE "SubmissionReceipt" (
    "key" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionReceipt_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "receiptKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "senderName" TEXT,
    "contact" TEXT,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "categoryId" TEXT,
    "postId" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionImage" (
    "submissionId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "SubmissionImage_pkey" PRIMARY KEY ("submissionId","mediaId")
);

-- CreateIndex
CREATE INDEX "SubmissionReceipt_createdAt_idx" ON "SubmissionReceipt"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_receiptKey_key" ON "Submission"("receiptKey");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_postId_key" ON "Submission"("postId");

-- CreateIndex
CREATE INDEX "Submission_status_createdAt_idx" ON "Submission"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Submission_categoryId_idx" ON "Submission"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionImage_mediaId_key" ON "SubmissionImage"("mediaId");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionImage_submissionId_order_key" ON "SubmissionImage"("submissionId", "order");

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_receiptKey_fkey" FOREIGN KEY ("receiptKey") REFERENCES "SubmissionReceipt"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionImage" ADD CONSTRAINT "SubmissionImage_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionImage" ADD CONSTRAINT "SubmissionImage_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
