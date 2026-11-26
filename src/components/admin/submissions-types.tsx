import type { AdminCategory, AdminImage, PostStatus } from "./types";

export type SubmissionStatus = "PENDING" | "APPROVED" | "REJECTED";

export type AdminSubmission = {
  id: string;
  title: string;
  content: string;
  status: SubmissionStatus;
  senderName: string | null;
  publicAuthorName?: string | null;
  contact: string | null;
  anonymous: boolean;
  categoryId: string | null;
  category: Pick<AdminCategory, "id" | "name" | "slug"> | null;
  images: AdminImage[];
  videos: AdminImage[];
  version: number;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  post: { id: string; slug: string; status: PostStatus } | null;
};

export const submissionStatusLabels: Record<SubmissionStatus, string> = {
  PENDING: "На модерации",
  APPROVED: "Опубликована",
  REJECTED: "Отклонена",
};

export function SubmissionBadge({ status }: { status: SubmissionStatus }) {
  return (
    <span className={`adm-status adm-submission-status-${status.toLowerCase()}`}>
      <span />
      {submissionStatusLabels[status]}
    </span>
  );
}
