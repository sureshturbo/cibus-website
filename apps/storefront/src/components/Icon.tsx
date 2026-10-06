import type { ReactNode, SVGProps } from "react";

/**
 * Icons are inlined rather than pulled from a sprite or icon font so they
 * inherit `currentColor` and add no network request. Geometry is drawn on a
 * 24x24 grid with a thin stroke, matching the line weight of the reference.
 */

const PATHS = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M16.5 16.5 21 21" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
    </>
  ),
  heart: (
    <path d="M12 20.5 3.9 12.4A4.6 4.6 0 0 1 12 6.2a4.6 4.6 0 0 1 8.1 6.2z" />
  ),
  cart: (
    <>
      <circle cx="9.5" cy="19.5" r="1.5" />
      <circle cx="17" cy="19.5" r="1.5" />
      <path d="M3 4h2.2l2.3 10.5h10.4l2.1-7.6H6.3" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  chevronDown: <path d="m6 9.5 6 6 6-6" />,
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  chevronLeft: <path d="m14.5 6-6 6 6 6" />,
  trash: (
    <>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
    </>
  ),
  menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  filter: <path d="M3 5h18l-7 8v6l-4 2v-8z" />,
  grid2: (
    <>
      <rect x="3.5" y="4" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="4" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="14" width="7" height="6" rx="1.5" />
      <rect x="13.5" y="14" width="7" height="6" rx="1.5" />
    </>
  ),
  grid3: (
    <>
      <rect x="3" y="4" width="5" height="16" rx="1.5" />
      <rect x="9.5" y="4" width="5" height="16" rx="1.5" />
      <rect x="16" y="4" width="5" height="16" rx="1.5" />
    </>
  ),
  grid4: (
    <>
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="8" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" />
    </>
  ),
  list: <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
  arrowRight: <path d="M4 12h15M13 6l6 6-6 6" />,
  arrowUp: <path d="M12 20V5M6 11l6-6 6 6" />,
  home: <path d="M4 11l8-7 8 7M6.5 9.5V20h11V9.5" />,
  box: (
    <>
      <path d="M4 7.5 12 3.5l8 4v9l-8 4-8-4z" />
      <path d="M4 7.5 12 11.5l8-4M12 11.5v9" />
    </>
  ),
  shield: <path d="M12 3l8 2.8V12c0 5-3.4 8.2-8 9-4.6-.8-8-4-8-9V5.8z" />,
  tag: (
    <>
      <path d="M4 11V4h7l9 9-7.5 7.5z" />
      <path d="M8 8h.01" />
    </>
  ),
  truck: (
    <>
      <path d="M3 6.5h11.5V17H3zM14.5 10h4l3 3.2V17h-7z" />
      <circle cx="7" cy="18.5" r="1.8" />
      <circle cx="17.5" cy="18.5" r="1.8" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17.5 14.4A6 6 0 0 1 21 20" />
    </>
  ),
  handshake: (
    <>
      <path d="M11 6.5 8.5 9 4 12l3 3.5 2-2 2.5 2.5a2 2 0 0 0 3 0l.5-.5" />
      <path d="M13 6.5 15.5 9 20 12l-1.5 1.8" />
      <path d="M2.5 12 1 14l2.5 3.5 2-2M21.5 12 23 14l-2.5 3.5-2-2" />
    </>
  ),
  phone: (
    <path d="M6 3h4l2 5-2.5 1.5a12.5 12.5 0 0 0 5 5L16 12l5 2v4a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4 5.2 2 2 0 0 1 6 3z" />
  ),
  mail: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </>
  ),
  mapPin: (
    <>
      <path d="M12 21s7-5.7 7-11a7 7 0 1 0-14 0c0 5.3 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M3 3l18 18" />
      <path d="M10.6 6.1A8.9 8.9 0 0 1 12 6c6 0 9.5 6 9.5 6a15 15 0 0 1-3.2 3.7M6.6 6.7A15.4 15.4 0 0 0 2.5 12S6 18 12 18a8.9 8.9 0 0 0 3.4-.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v5M12 15.5h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11.5v5M12 8h.01" />
    </>
  ),
  leaf: (
    <path d="M20.5 3.5C10 3.8 4 8.8 4 15.8c0 1.9.5 3.4 1 4.3 1.2-6 6.2-9.2 11.3-10.3-4.2 2-7.4 5-8.4 10.2 1 .4 2 .5 3.2.5 6.1 0 9.4-6.4 9.4-17z" />
  ),
  bolt: <path d="M13 3 5.5 14H11l-1 7 8.5-11H13z" />,
  refresh: (
    <>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.5-6" />
      <path d="M20.5 4.5V10H15" />
    </>
  ),
  logout: (
    <>
      <path d="M15 12H4M8 8l-4 4 4 4" />
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
    </>
  ),
  facebook: (
    <path
      d="M13.5 21v-8h2.7l.4-3.1h-3.1V7.9c0-.9.3-1.5 1.6-1.5h1.6V3.6c-.3 0-1.3-.1-2.4-.1-2.4 0-4.1 1.5-4.1 4.2v2.2H7.5V13h2.7v8z"
      fill="currentColor"
      stroke="none"
    />
  ),
  instagram: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="3.6" />
      <path d="M17 7h.01" />
    </>
  ),
  linkedin: (
    <path
      d="M7 10.5V20H4V10.5zM5.5 7.6a1.65 1.65 0 1 0 0-3.3 1.65 1.65 0 0 0 0 3.3M20 20h-3v-5.4c0-1.3-.5-2.2-1.7-2.2-1 0-1.5.7-1.7 1.3-.1.2-.1.6-.1.9V20h-3v-9.5h3V12c.4-.6 1.2-1.7 3-1.7 2.2 0 3.5 1.5 3.5 4.4z"
      fill="currentColor"
      stroke="none"
    />
  ),
  x: (
    <path
      d="M17.5 4h2.7l-6 6.8L21 20h-5.3l-3.7-4.9L7.5 20H4.8l6.4-7.3L3.8 4h5.4l3.4 4.5zm-.9 14.3h1.4L8.3 5.6H6.8z"
      fill="currentColor"
      stroke="none"
    />
  ),
} as const satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

/**
 * Server-authored content names icons as strings. Resolve them through here so
 * a renamed or unknown name degrades to a neutral icon instead of crashing the
 * render on an undefined key.
 */
export function iconFor(name: string): IconName {
  return name in PATHS ? (name as IconName) : "info";
}

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  /** Rendered size in pixels. Defaults to 24, the design grid. */
  size?: number;
}

export default function Icon({ name, size = 24, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}