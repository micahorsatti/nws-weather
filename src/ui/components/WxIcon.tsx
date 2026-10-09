/**
 * Hand-drawn weather icons (no icon fonts, images or CDNs). One 64x64 grid, flat fills with a thin
 * outline, rounded caps; colors come from the --wx-* tokens so they adapt to light, dark and the hero's sky.
 * Pass `day={false}` for the night variant (moon instead of sun) where it matters.
 */
import type { ReactNode, SVGProps } from 'react';
import type { WxIcon as WxIconName } from '../../data/types';

type Tone = 'cloud' | 'shade' | 'storm' | 'smoke';

const CLOUD_SHAPES = (
  <>
    <rect x="11" y="33" width="42" height="17" rx="8.5" />
    <circle cx="25" cy="34" r="9.5" />
    <circle cx="36" cy="27" r="13" />
    <circle cx="46.5" cy="36" r="8.5" />
  </>
);

const TONES: Record<Tone, { fill: string; edge: string }> = {
  cloud: { fill: 'var(--wx-cloud)', edge: 'var(--wx-cloud-edge)' },
  shade: { fill: 'var(--wx-cloud-shade)', edge: 'var(--wx-cloud-edge)' },
  storm: { fill: 'var(--wx-storm)', edge: 'var(--wx-storm-edge)' },
  smoke: { fill: 'var(--wx-smoke)', edge: 'var(--wx-storm-edge)' },
};

/** Cloud silhouette (union of shapes, so the outline has no internal seams). */
function Cloud({ x = 0, y = 0, s = 1, tone = 'cloud' }: { x?: number; y?: number; s?: number; tone?: Tone }) {
  const { fill, edge } = TONES[tone];
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <g fill={edge} stroke={edge} strokeWidth={3} strokeLinejoin="round">
        {CLOUD_SHAPES}
      </g>
      <g fill={fill}>{CLOUD_SHAPES}</g>
    </g>
  );
}

const RAY_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

function Sun({ cx, cy, r, color = 'var(--wx-sun)', hi = 'var(--wx-sun-hi)', rays = true }: { cx: number; cy: number; r: number; color?: string; hi?: string; rays?: boolean }) {
  const inner = r + r * 0.4;
  const outer = r + r * 0.85;
  return (
    <g>
      {rays &&
        RAY_ANGLES.map((deg) => {
          const a = (deg * Math.PI) / 180;
          return (
            <line
              key={deg}
              x1={cx + Math.cos(a) * inner}
              y1={cy + Math.sin(a) * inner}
              x2={cx + Math.cos(a) * outer}
              y2={cy + Math.sin(a) * outer}
              stroke={color}
              strokeWidth={Math.max(2.2, r * 0.3)}
              strokeLinecap="round"
            />
          );
        })}
      <circle cx={cx} cy={cy} r={r} fill={color} stroke="var(--wx-sun-edge)" strokeWidth={1.2} />
      <circle cx={cx - r * 0.22} cy={cy - r * 0.22} r={r * 0.62} fill={hi} />
    </g>
  );
}

/** Crescent = circle O minus an offset circle C; both arcs are derived from the circle intersection. */
export function crescentPath(cx: number, cy: number, R: number, dx: number, dy: number, r: number): string {
  const d = Math.hypot(dx, dy);
  const a = (R * R - r * r + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, R * R - a * a));
  const ux = dx / d;
  const uy = dy / d;
  const px = cx + a * ux;
  const py = cy + a * uy;
  const x1 = px - h * uy;
  const y1 = py + h * ux;
  const x2 = px + h * uy;
  const y2 = py - h * ux;
  // Outer arc from (x1,y1) round the far side to (x2,y2), then back along the cut-out circle.
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 1 0 ${x2.toFixed(2)} ${y2.toFixed(2)} A ${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
}

function Moon({ cx, cy, r, stars = false }: { cx: number; cy: number; r: number; stars?: boolean }) {
  const d = crescentPath(cx, cy, r, r * 0.42, -r * 0.42, r * 0.86);
  return (
    <g>
      <path d={d} fill="var(--wx-moon)" stroke="var(--wx-moon-edge)" strokeWidth={1.4} strokeLinejoin="round" />
      {stars && (
        <>
          <Sparkle x={cx + r * 1.1} y={cy + r * 0.55} s={3} />
          <Sparkle x={cx + r * 0.45} y={cy - r * 1.15} s={2.2} />
        </>
      )}
    </g>
  );
}

function Sparkle({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g stroke="var(--wx-moon)" strokeWidth={1.6} strokeLinecap="round">
      <line x1={x - s} y1={y} x2={x + s} y2={y} />
      <line x1={x} y1={y - s} x2={x} y2={y + s} />
    </g>
  );
}

function Drop({ x, y, len = 8, w = 3.4, color = 'var(--wx-rain)' }: { x: number; y: number; len?: number; w?: number; color?: string }) {
  return <line x1={x} y1={y} x2={x - len * 0.38} y2={y + len} stroke={color} strokeWidth={w} strokeLinecap="round" />;
}

function Flake({ x, y, r = 4.2 }: { x: number; y: number; r?: number }) {
  return (
    <g stroke="var(--wx-snow)" strokeWidth={2} strokeLinecap="round">
      {[0, 60, 120].map((deg) => {
        const a = (deg * Math.PI) / 180;
        return <line key={deg} x1={x - Math.cos(a) * r} y1={y - Math.sin(a) * r} x2={x + Math.cos(a) * r} y2={y + Math.sin(a) * r} />;
      })}
    </g>
  );
}

function Pellet({ x, y }: { x: number; y: number }) {
  return <circle cx={x} cy={y} r={2.4} fill="var(--wx-ice)" />;
}

function Bolt({ x = 0, y = 0, s = 1 }: { x?: number; y?: number; s?: number }) {
  return (
    <path
      transform={`translate(${x} ${y}) scale(${s})`}
      d="M35 28 L25 44 L32 44 L28 58 L41 39 L34 39 L39 28 Z"
      fill="var(--wx-bolt)"
      stroke="var(--wx-bolt-edge)"
      strokeWidth={1.4}
      strokeLinejoin="round"
    />
  );
}

function Bar({ x1, x2, y, color = 'var(--wx-fog)', w = 4 }: { x1: number; x2: number; y: number; color?: string; w?: number }) {
  return <line x1={x1} y1={y} x2={x2} y2={y} stroke={color} strokeWidth={w} strokeLinecap="round" />;
}

function Swirl({ arms, thick, eye }: { arms: number; thick: number; eye: string }) {
  const rotations = arms === 2 ? [0, 180] : [0, 120, 240];
  return (
    <g>
      {rotations.map((deg) => (
        <path
          key={deg}
          d="M32 25 C42 20 53 30 47 42"
          transform={`rotate(${deg} 32 32)`}
          fill="none"
          stroke="var(--wx-wind)"
          strokeWidth={thick}
          strokeLinecap="round"
        />
      ))}
      <circle cx={32} cy={32} r={5} fill="var(--wx-cloud)" stroke={eye} strokeWidth={2} />
    </g>
  );
}

/** The sun in the day variant, the moon at night, at the same spot. */
function Luminary({ day, cx, cy, r, stars }: { day: boolean; cx: number; cy: number; r: number; stars?: boolean }) {
  return day ? <Sun cx={cx} cy={cy} r={r} /> : <Moon cx={cx} cy={cy} r={r * 1.15} stars={stars} />;
}

function drawIcon(icon: WxIconName, day: boolean): ReactNode {
  switch (icon) {
    case 'clear':
      return day ? <Sun cx={32} cy={32} r={12.5} /> : <Moon cx={31} cy={33} r={17} stars />;
    case 'mostly-clear':
      return (
        <>
          <Luminary day={day} cx={29} cy={28} r={11} stars />
          <Cloud x={25} y={14} s={0.55} />
        </>
      );
    case 'partly-cloudy':
      return (
        <>
          <Luminary day={day} cx={24} cy={24} r={9.5} stars />
          <Cloud x={11} y={12} s={0.82} />
        </>
      );
    case 'mostly-cloudy':
      return (
        <>
          <Luminary day={day} cx={22} cy={21} r={7.5} />
          <Cloud x={5} y={9} s={0.96} />
        </>
      );
    case 'cloudy':
      return (
        <>
          <Cloud x={14} y={-2} s={0.74} tone="shade" />
          <Cloud x={3} y={9} s={0.96} />
        </>
      );
    case 'fog':
      return (
        <>
          <Cloud x={6} y={-6} s={0.88} />
          <Bar x1={12} x2={46} y={44} />
          <Bar x1={20} x2={54} y={52} />
          <Bar x1={12} x2={38} y={60} />
        </>
      );
    case 'haze':
      return (
        <>
          <Luminary day={day} cx={32} cy={26} r={11} />
          <Bar x1={10} x2={54} y={44} color="var(--wx-fog)" />
          <Bar x1={16} x2={48} y={52} color="var(--wx-fog)" />
          <Bar x1={22} x2={42} y={60} color="var(--wx-fog)" />
        </>
      );
    case 'smoke':
      return (
        <>
          <Cloud x={4} y={-6} s={0.96} tone="smoke" />
          <path d="M16 48 q5 -5 10 0 t10 0 t10 0" fill="none" stroke="var(--wx-smoke)" strokeWidth={3.4} strokeLinecap="round" />
          <path d="M22 57 q5 -5 10 0 t10 0" fill="none" stroke="var(--wx-smoke)" strokeWidth={3.4} strokeLinecap="round" />
        </>
      );
    case 'dust':
      return (
        <>
          <Bar x1={10} x2={50} y={22} color="var(--wx-dust)" />
          <Bar x1={18} x2={56} y={32} color="var(--wx-dust)" />
          <Bar x1={10} x2={44} y={42} color="var(--wx-dust)" />
          <Bar x1={22} x2={52} y={52} color="var(--wx-dust)" />
          <circle cx={56} cy={42} r={2} fill="var(--wx-dust)" />
          <circle cx={50} cy={14} r={2} fill="var(--wx-dust)" />
          <circle cx={8} cy={52} r={2} fill="var(--wx-dust)" />
        </>
      );
    case 'wind':
      return (
        <g fill="none" stroke="var(--wx-wind)" strokeWidth={3.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 24 H38 a7 7 0 1 0 -7 -7" />
          <path d="M8 34 H48 a7.5 7.5 0 1 1 -7.5 7.5" />
          <path d="M14 46 H33 a6 6 0 1 1 -6 6" />
        </g>
      );
    case 'drizzle':
      return (
        <>
          <Cloud x={2.5} y={-6} s={0.92} />
          <Drop x={22} y={44} len={5} w={2.8} />
          <Drop x={33} y={48} len={5} w={2.8} />
          <Drop x={44} y={44} len={5} w={2.8} />
          <Drop x={27} y={56} len={4} w={2.8} />
          <Drop x={39} y={57} len={4} w={2.8} />
        </>
      );
    case 'rain-showers':
      return (
        <>
          <Luminary day={day} cx={21} cy={19} r={7.5} />
          <Cloud x={6} y={-1} s={0.9} />
          <Drop x={23} y={44} />
          <Drop x={34} y={46} />
          <Drop x={45} y={44} />
        </>
      );
    case 'rain':
      return (
        <>
          <Cloud x={2.5} y={-5} s={0.92} />
          <Drop x={21} y={44} />
          <Drop x={32} y={47} />
          <Drop x={43} y={44} />
        </>
      );
    case 'heavy-rain':
      return (
        <>
          <Cloud x={2.5} y={-7} s={0.9} tone="shade" />
          <Drop x={17} y={41} len={9} w={3.6} />
          <Drop x={27} y={44} len={9} w={3.6} />
          <Drop x={37} y={41} len={9} w={3.6} />
          <Drop x={47} y={44} len={9} w={3.6} />
          <Drop x={22} y={53} len={8} w={3.6} />
          <Drop x={32} y={55} len={7} w={3.6} />
          <Drop x={42} y={53} len={8} w={3.6} />
        </>
      );
    case 'thunderstorm':
      return (
        <>
          <Cloud x={2.5} y={-8} s={0.92} tone="storm" />
          <Bolt x={-2} y={-6} />
          <Drop x={19} y={43} len={7} />
          <Drop x={47} y={43} len={7} />
        </>
      );
    case 'severe-thunderstorm':
      return (
        <>
          <Cloud x={0} y={-9} s={0.92} tone="storm" />
          <Bolt x={-6} y={-6} />
          <Bolt x={5} y={-3} s={0.85} />
          <Drop x={15} y={43} len={7} />
          <g>
            <path d="M50 42 L60 59 L40 59 Z" fill="var(--sev-severe-bg)" stroke="#fff" strokeWidth={1.6} strokeLinejoin="round" />
            <line x1={50} y1={47.5} x2={50} y2={53} stroke="#fff" strokeWidth={2} strokeLinecap="round" />
            <circle cx={50} cy={56.2} r={1.1} fill="#fff" />
          </g>
        </>
      );
    case 'snow-showers':
      return (
        <>
          <Luminary day={day} cx={21} cy={19} r={7.5} />
          <Cloud x={6} y={-1} s={0.9} />
          <Flake x={23} y={47} />
          <Flake x={36} y={51} />
          <Flake x={47} y={46} />
        </>
      );
    case 'snow':
      return (
        <>
          <Cloud x={2.5} y={-5} s={0.92} />
          <Flake x={20} y={46} />
          <Flake x={32} y={52} />
          <Flake x={44} y={46} />
        </>
      );
    case 'heavy-snow':
      return (
        <>
          <Cloud x={2.5} y={-8} s={0.9} tone="shade" />
          <Flake x={16} y={42} r={4.6} />
          <Flake x={29} y={46} r={4.6} />
          <Flake x={42} y={42} r={4.6} />
          <Flake x={52} y={48} r={4.6} />
          <Flake x={22} y={55} r={4.6} />
          <Flake x={36} y={57} r={4.6} />
        </>
      );
    case 'blizzard':
      return (
        <>
          <Cloud x={2.5} y={-9} s={0.86} tone="shade" />
          <path d="M8 44 H40 a6 6 0 1 0 -6 -6" fill="none" stroke="var(--wx-wind)" strokeWidth={3.2} strokeLinecap="round" />
          <path d="M16 54 H50 a6 6 0 1 1 -6 6" fill="none" stroke="var(--wx-wind)" strokeWidth={3.2} strokeLinecap="round" />
          <Flake x={50} y={40} r={4} />
          <Flake x={12} y={58} r={3.6} />
        </>
      );
    case 'sleet':
      return (
        <>
          <Cloud x={2.5} y={-5} s={0.92} />
          <Drop x={20} y={44} />
          <Pellet x={32} y={51} />
          <Drop x={44} y={44} />
          <Pellet x={24} y={58} />
          <Pellet x={40} y={58} />
        </>
      );
    case 'freezing-rain':
      return (
        <>
          <Cloud x={2.5} y={-5} s={0.92} />
          <Drop x={21} y={44} />
          <Drop x={32} y={47} />
          <Drop x={43} y={44} />
          <Pellet x={27} y={58} />
          <Pellet x={38} y={58} />
          <Pellet x={49} y={55} />
        </>
      );
    case 'rain-snow':
      return (
        <>
          <Cloud x={2.5} y={-5} s={0.92} />
          <Drop x={22} y={44} />
          <Flake x={34} y={52} />
          <Drop x={45} y={44} />
        </>
      );
    case 'hot':
      return (
        <>
          <Sun cx={32} cy={24} r={10} color="var(--wx-hot)" hi="var(--wx-sun-hi)" />
          <path d="M12 50 q5 -6 10 0 t10 0 t10 0 t10 0" fill="none" stroke="var(--wx-hot)" strokeWidth={3.4} strokeLinecap="round" />
          <path d="M18 59 q5 -6 10 0 t10 0 t10 0" fill="none" stroke="var(--wx-hot)" strokeWidth={3.4} strokeLinecap="round" opacity={0.7} />
        </>
      );
    case 'cold':
      return (
        <>
          <rect x={14} y={10} width={13} height={36} rx={6.5} fill="var(--wx-cloud)" stroke="var(--wx-cloud-edge)" strokeWidth={1.6} />
          <circle cx={20.5} cy={48} r={9} fill="var(--wx-cloud)" stroke="var(--wx-cloud-edge)" strokeWidth={1.6} />
          <rect x={18} y={30} width={5} height={18} rx={2.5} fill="var(--wx-cold)" />
          <circle cx={20.5} cy={48} r={5.6} fill="var(--wx-cold)" />
          <g stroke="var(--wx-cold)" strokeWidth={3} strokeLinecap="round">
            <line x1={46} y1={17} x2={46} y2={41} />
            <line x1={35.6} y1={23} x2={56.4} y2={35} />
            <line x1={35.6} y1={35} x2={56.4} y2={23} />
          </g>
        </>
      );
    case 'tornado':
      return (
        <>
          <Cloud x={4} y={-10} s={0.92} tone="storm" />
          <Bar x1={14} x2={52} y={34} color="var(--wx-wind)" w={4.4} />
          <Bar x1={19} x2={49} y={42} color="var(--wx-wind)" w={4.4} />
          <Bar x1={24} x2={46} y={50} color="var(--wx-wind)" w={4.4} />
          <Bar x1={30} x2={42} y={58} color="var(--wx-wind)" w={4.4} />
        </>
      );
    case 'tropical-storm':
      return <Swirl arms={2} thick={4.6} eye="var(--wx-wind)" />;
    case 'hurricane':
      return <Swirl arms={3} thick={5.4} eye="var(--wx-hot)" />;
    default:
      return (
        <>
          <Cloud x={2} y={-2} s={1} />
          <path d="M27 28 q0 -7 7 -7 t7 6 q0 4 -5 6 q-3 1.6 -3 5" fill="none" stroke="var(--wx-mark)" strokeWidth={3} strokeLinecap="round" />
          <circle cx={33} cy={42} r={1.8} fill="var(--wx-mark)" />
        </>
      );
  }
}

/** Plain-language names, for screen readers and tooltips. */
export const ICON_LABELS: Record<WxIconName, string> = {
  clear: 'Clear',
  'mostly-clear': 'Mostly clear',
  'partly-cloudy': 'Partly cloudy',
  'mostly-cloudy': 'Mostly cloudy',
  cloudy: 'Cloudy',
  fog: 'Fog',
  haze: 'Haze',
  smoke: 'Smoke',
  dust: 'Dust',
  wind: 'Windy',
  drizzle: 'Drizzle',
  'rain-showers': 'Rain showers',
  rain: 'Rain',
  'heavy-rain': 'Heavy rain',
  thunderstorm: 'Thunderstorm',
  'severe-thunderstorm': 'Severe thunderstorm',
  'snow-showers': 'Snow showers',
  snow: 'Snow',
  'heavy-snow': 'Heavy snow',
  blizzard: 'Blizzard',
  sleet: 'Sleet',
  'freezing-rain': 'Freezing rain',
  'rain-snow': 'Rain and snow',
  hot: 'Hot',
  cold: 'Cold',
  tornado: 'Tornado',
  'tropical-storm': 'Tropical storm',
  hurricane: 'Hurricane',
  unknown: 'Conditions unknown',
};

export const ALL_ICONS = Object.keys(ICON_LABELS) as WxIconName[];

export interface WxIconProps extends Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'children'> {
  icon: WxIconName;
  /** Daytime artwork (sun) when true or omitted; night artwork (moon) when false. */
  day?: boolean;
  size?: number;
  /** Accessible name. Omit when the icon is decorative (adjacent text says the same thing). */
  label?: string;
}

export function WxIcon({ icon, day = true, size = 32, label, className, ...rest }: WxIconProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className ? `wx ${className}` : 'wx'}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...rest}
    >
      {drawIcon(icon, day)}
    </svg>
  );
}
