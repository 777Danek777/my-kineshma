import type { ReactNode } from "react";
import { statusLabels, type PostStatus } from "./types";

export type IconName =
  | "dashboard"
  | "posts"
  | "categories"
  | "plus"
  | "arrow"
  | "logout"
  | "image"
  | "check"
  | "search"
  | "edit"
  | "trash"
  | "lock"
  | "external"
  | "menu";

export function AdminIcon({
  name,
  size = 20,
}: {
  name: IconName;
  size?: number;
}) {
  const paths: Record<IconName, ReactNode> = {
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    posts: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 7h8M8 11h8M8 15h5" />
      </>
    ),
    categories: (
      <>
        <path d="M3 7V5a2 2 0 0 1 2-2h6l10 10-8 8L3 11V7Z" />
        <circle cx="7.5" cy="7.5" r=".8" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="m9 5 7 7-7 7" />,
    logout: (
      <>
        <path d="M9 4H5v16h4M10 12h11m-4-4 4 4-4 4" />
      </>
    ),
    image: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8" cy="8" r="1.5" />
        <path d="m3 17 5-5 4 4 4-6 5 7" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    edit: (
      <>
        <path d="m4 16-1 5 5-1L20 8l-4-4L4 16Zm10-10 4 4" />
      </>
    ),
    trash: (
      <>
        <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
      </>
    ),
    external: (
      <>
        <path d="M14 3h7v7M10 14 21 3M10 3H3v18h18v-7" />
      </>
    ),
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

export function AdminNotice({
  children,
  kind = "error",
}: {
  children: ReactNode;
  kind?: "error" | "success" | "info";
}) {
  return (
    <div
      className={`adm-notice adm-notice-${kind}`}
      role={kind === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}

export function StatusBadge({ status }: { status: PostStatus }) {
  return (
    <span className={`adm-status adm-status-${status.toLowerCase()}`}>
      <span />
      {statusLabels[status]}
    </span>
  );
}

export function AdminLoading() {
  return (
    <div className="adm-loading" role="status">
      <span className="adm-spinner" />
      Загружаем данные…
    </div>
  );
}

export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="adm-heading">
      <div>
        <p className="adm-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="adm-description">{description}</p>
      </div>
      {action}
    </div>
  );
}
