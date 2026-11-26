"use client";

export type SocialStats = {
  likeCount: number;
  commentCount: number;
  liked: boolean;
};

export type PublicComment = {
  id: string;
  displayName: string;
  content: string;
  createdAt: string;
  parentId: string | null;
  likeCount: number;
  liked: boolean;
  replyCount: number;
  replies: PublicComment[];
};

export type CommentsPage = {
  items: PublicComment[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  rootTotal: number;
  preview: boolean;
  parentId: string | null;
};

type ErrorFields = Record<string, string | string[] | undefined>;
type Session = { csrfToken: string; expiresAt: number };
type RequestOptions = {
  method?: "GET" | "POST" | "PUT";
  body?: Record<string, unknown>;
  signal?: AbortSignal;
};

export class SocialApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly fieldErrors: ErrorFields = {},
  ) {
    super(message);
    this.name = "SocialApiError";
  }
}

let activeSession: Session | null = null;
let sessionPromise: Promise<Session> | null = null;

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new SocialApiError(
      typeof data?.error === "string" ? data.error : "Не удалось выполнить запрос. Попробуйте ещё раз.",
      response.status,
      data?.fieldErrors && typeof data.fieldErrors === "object" ? data.fieldErrors : {},
    );
  }
  if (!data || typeof data !== "object") {
    throw new SocialApiError("Не удалось получить ответ сайта. Попробуйте ещё раз.", response.status);
  }
  return data as T;
}

/** All cards share this promise so the first visit creates exactly one cookie. */
export async function ensureSocialSession(): Promise<Session> {
  if (activeSession && activeSession.expiresAt > Date.now()) return activeSession;
  if (sessionPromise) return sessionPromise;
  const request = (async () => {
    const response = await fetch("/api/social/session", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const result = await readResponse<{ csrfToken: string }>(response);
    if (typeof result.csrfToken !== "string" || !result.csrfToken) {
      throw new SocialApiError("Не удалось подготовить действия на сайте. Попробуйте ещё раз.", 503);
    }
    activeSession = { csrfToken: result.csrfToken, expiresAt: Date.now() + 119 * 60 * 1000 };
    return activeSession;
  })();
  sessionPromise = request;
  try {
    return await request;
  } finally {
    if (sessionPromise === request) sessionPromise = null;
  }
}

async function socialRequest<T>(slug: string, endpoint: string, options: RequestOptions = {}, retry = true): Promise<T> {
  const session = await ensureSocialSession();
  const method = options.method ?? "GET";
  const response = await fetch(`/api/posts/${encodeURIComponent(slug)}/${endpoint}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    signal: options.signal,
    ...(method !== "GET" ? {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...options.body, csrfToken: session.csrfToken }),
    } : {}),
  });
  if (response.status === 403 && retry) {
    // A concurrent request may already have refreshed the same expired token.
    if (activeSession?.csrfToken === session.csrfToken) activeSession = null;
    return socialRequest<T>(slug, endpoint, options, false);
  }
  return readResponse<T>(response);
}

export function getSocialStats(slug: string, signal?: AbortSignal) {
  return socialRequest<SocialStats>(slug, "social", { signal });
}

export function setPostLike(slug: string, liked: boolean) {
  return socialRequest<SocialStats>(slug, "like", { method: "PUT", body: { liked } });
}

export function getPublicationComments(slug: string, page: number, signal?: AbortSignal, options: { preview?: boolean; parentId?: string } = {}) {
  const query = new URLSearchParams({ page: String(page), ...(options.preview ? { preview: "1" } : {}), ...(options.parentId ? { parentId: options.parentId } : {}) });
  return socialRequest<CommentsPage>(slug, `comments?${query}`, { signal });
}

export function getCommentForm(slug: string, signal?: AbortSignal) {
  return socialRequest<{ token: string; minimumWaitMs: number; moderationEnabled: boolean }>(slug, "comments/form", { signal });
}

export function sendPublicationComment(slug: string, input: { displayName?: string; content: string; token: string; website: string; parentId?: string | null }) {
  return socialRequest<{ success: boolean; status: string; message: string }>(slug, "comments", { method: "POST", body: input });
}

export function setCommentLike(slug: string, id: string, liked: boolean) {
  return socialRequest<{ id: string; likeCount: number; liked: boolean }>(slug, `comments/${encodeURIComponent(id)}/like`, { method: "PUT", body: { liked } });
}

export const COMMENTS_REFRESH_EVENT = "my-kineshma:comments-refresh";
export function announceCommentsRefresh(slug: string, parentId: string | null = null) {
  window.dispatchEvent(new CustomEvent(COMMENTS_REFRESH_EVENT, { detail: { slug, parentId } }));
}

export const SOCIAL_UPDATED_EVENT = "my-kineshma:social-updated";
export type SocialUpdate = { slug: string; stats: Partial<SocialStats> };

export function announceSocialUpdate(slug: string, stats: Partial<SocialStats>) {
  window.dispatchEvent(new CustomEvent<SocialUpdate>(SOCIAL_UPDATED_EVENT, { detail: { slug, stats } }));
}

export function socialErrorMessage(error: unknown, fallback: string) {
  return error instanceof SocialApiError ? error.message : fallback;
}
