import type { PostStatus } from "./types";

export type AdminCommentStatus = "PENDING" | "APPROVED" | "REJECTED";

export type AdminComment = {
  id: string;
  displayName: string;
  content: string;
  status: AdminCommentStatus;
  createdAt: string;
  updatedAt: string;
  version: number;
  parentId: string | null;
  parent: { id: string; displayName: string; content: string; status: AdminCommentStatus } | null;
  _count: { replies: number };
  post: {
    id: string;
    slug: string;
    title: string;
    status: PostStatus;
  };
};

export type AdminCommentsResult = {
  items: AdminComment[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export const commentStatusLabels: Record<AdminCommentStatus, string> = {
  PENDING: "На модерации",
  APPROVED: "Одобрен",
  REJECTED: "Отклонён",
};
