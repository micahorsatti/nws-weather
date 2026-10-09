/** Small interface icons (24px grid, 2px round strokes, currentColor). All decorative: pair with text or aria-label. */
import type { ReactNode, SVGProps } from 'react';

type P = Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'children'> & { size?: number };

function Svg({ size = 20, children, ...rest }: P & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconRefresh = (p: P) => (
  <Svg {...p}>
    <path d="M19 12a7 7 0 1 1-2.05-4.95" />
    <path d="M19 4.5V9h-4.5" />
  </Svg>
);

export const IconSliders = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h3M11 7h9" />
    <circle cx="9" cy="7" r="2" />
    <path d="M4 12h9M17 12h3" />
    <circle cx="15" cy="12" r="2" />
    <path d="M4 17h5M13 17h7" />
    <circle cx="11" cy="17" r="2" />
  </Svg>
);

export const IconChevronDown = (p: P) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

export const IconChevronRight = (p: P) => (
  <Svg {...p}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);

export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

export const IconStar = ({ filled = false, ...p }: P & { filled?: boolean }) => (
  <Svg {...p} fill={filled ? 'currentColor' : 'none'}>
    <path d="m12 3.6 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17.4l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z" />
  </Svg>
);

export const IconPin = (p: P) => (
  <Svg {...p}>
    <path d="M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 1 1 13 0c0 5.3-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.4" />
  </Svg>
);

export const IconLocate = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="6.5" />
    <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
  </Svg>
);

export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Svg>
);

export const IconAlert = (p: P) => (
  <Svg {...p}>
    <path d="M12 3.8 21.4 20H2.6z" />
    <path d="M12 10v4.2" />
    <circle cx="12" cy="17.2" r="0.6" fill="currentColor" />
  </Svg>
);

export const IconRadar = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <path d="M12 12 18.4 5.6" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
  </Svg>
);

export const IconExternal = (p: P) => (
  <Svg {...p}>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
  </Svg>
);

export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);

export const IconInfo = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5" />
    <circle cx="12" cy="7.8" r="0.6" fill="currentColor" />
  </Svg>
);

export const IconTrash = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.5h10L18 7M9 7V4.5h6V7" />
  </Svg>
);

/** Small solid triangles for the hero's high/low line. */
export const IconTriUp = ({ size = 10, ...rest }: P) => (
  <svg viewBox="0 0 10 10" width={size} height={size} aria-hidden="true" focusable="false" {...rest}>
    <path d="M5 1.5 9 8H1z" fill="currentColor" />
  </svg>
);

export const IconTriDown = ({ size = 10, ...rest }: P) => (
  <svg viewBox="0 0 10 10" width={size} height={size} aria-hidden="true" focusable="false" {...rest}>
    <path d="M5 8.5 1 2h8z" fill="currentColor" />
  </svg>
);

/** An arrow pointing up (north) at rotation 0; rotate to show where the wind is blowing toward. */
export const IconWindArrow = ({ size = 16, rotate = 0, ...rest }: P & { rotate?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" {...rest}>
    <g transform={`rotate(${rotate} 12 12)`}>
      <path d="M12 3.2 17.4 19 12 15.8 6.6 19z" fill="currentColor" />
    </g>
  </svg>
);
