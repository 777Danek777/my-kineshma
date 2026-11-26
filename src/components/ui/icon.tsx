import type { CSSProperties } from "react";

export type IconName =
  | "search"
  | "menu"
  | "close"
  | "pin"
  | "plus"
  | "chevron"
  | "clock"
  | "camera"
  | "message"
  | "sun"
  | "check"
  | "external"
  | "info"
  | "vk";

const paths: Record<Exclude<IconName, "vk">, React.ReactNode> = {
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.8" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  menu: (
    <>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  pin: (
    <>
      <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
      <circle cx="12" cy="10" r="2.2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  camera: (
    <>
      <path d="M4 7h4l2-3h4l2 3h4a1 1 0 0 1 1 1v11H3V8a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  message: (
    <path d="M21 11.5a8.5 8.5 0 0 1-9 8.5 9 9 0 0 1-4-.9L3 21l1.5-5A8.5 8.5 0 1 1 21 11.5Z" />
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" />
    </>
  ),
  check: <path d="m5 12 4.5 4.5L19 7" />,
  external: (
    <>
      <path d="M14 4h6v6M20 4l-9 9M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7v.1" />
    </>
  ),
};

export function Icon({
  name,
  size = 20,
  className,
  style,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  if (name === "vk")
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        className={className}
        style={style}
      >
        <path d="M3 5h3.1c.2 5 2.3 7.2 4 7.6V5h3v4.4c1.7-.2 3.5-2.3 4.1-4.4h3c-.5 2.7-2.5 4.8-4 5.7 1.5.7 3.7 2.5 4.6 5.8h-3.4c-.7-2.2-2.3-3.9-4.3-4.1v4.1h-.5C5.7 16.5 2 12.1 3 5Z" />
      </svg>
    );
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={style}
    >
      {paths[name]}
    </svg>
  );
}
