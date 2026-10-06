// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Набор линейных SVG-иконок интерфейса (docs/REDESIGN.md).
 *
 * Эмодзи в навигации и кнопках зависят от системного шрифта и на части
 * систем рисуются пустыми квадратами, поэтому служебные значки — inline SVG
 * (stroke = currentColor, наследуют цвет текста). Иконки декоративны:
 * подпись всегда есть рядом текстом или в aria-label кнопки.
 */
import type { SVGProps } from 'react';

const PATHS = {
  home: 'M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z',
  wallet:
    'M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3M4 7.5V17a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H6.5A2.5 2.5 0 0 1 4 7.5Zm12.5 6h.01',
  plus: 'M12 5v14M5 12h14',
  heart: 'M12 19s-7-4.35-7-9.5A3.75 3.75 0 0 1 12 7a3.75 3.75 0 0 1 7 2.5C19 14.65 12 19 12 19Z',
  chart: 'M5 19V11m5 8V6m5 13v-9m5 9V14M3 19h18',
  check: 'M5 12.5 10 17l9-10',
  sparkle: 'M12 4v4m0 8v4M4 12h4m8 0h4M7 7l2 2m6 6 2 2m0-10-2 2m-6 6-2 2',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4m8-4h3a3 3 0 0 1-3 4m-4 3v4m-3 3h6',
  target:
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-4a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-4a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  feed: 'M5 6h14M5 12h14M5 18h9',
  users:
    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9a6 6 0 0 1 12 0m1-9a3 3 0 1 0-1.5-5.6M21 20a5 5 0 0 0-5-5',
  capsule: 'M6 9h12v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1zM4 5h16v4H4zm6 8h4',
  flag: 'M5 21V4m0 0h11l-2 4 2 4H5',
  bot: 'M7 9h10a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-4a3 3 0 0 1 3-3Zm5-4v4m-3 5h.01M15 14h.01',
  shield: 'M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
  page: 'M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm7 0v5h5M9 13h6m-6 4h6',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.3l2-1.6-2-3.4-2.4 1a7.3 7.3 0 0 0-2.2-1.3L14.3 3h-4l-.4 2.4a7.3 7.3 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.6l-2 1.6 2 3.4 2.4-1a7.3 7.3 0 0 0 2.2 1.3l.4 2.4h4l.4-2.4a7.3 7.3 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.6c.07-.43.1-.86.1-1.3Z',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  eyeOff:
    'M4 4l16 16M10.6 6a9.6 9.6 0 0 1 1.4-.1c6 0 9.5 6.1 9.5 6.1a17 17 0 0 1-2.6 3.3M6.6 7.3A16.4 16.4 0 0 0 2.5 12s3.5 6.5 9.5 6.5a9 9 0 0 0 4.4-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2',
  logout: 'M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3M10 8l-4 4 4 4m-4-4h11',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  close: 'M6 6l12 12M18 6 6 18',
  calendar:
    'M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm-1 4h16M8 3v4m8-4v4',
  repeat: 'M17 3l3 3-3 3M20 6H8a4 4 0 0 0-4 4v1m3 10-3-3 3-3M4 18h12a4 4 0 0 0 4-4v-1',
  inbox: 'M4 13h4l2 3h4l2-3h4M5 5h14l1 8v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5z',
  arrowRight: 'M5 12h14m-5-5 5 5-5 5',
  pulse: 'M3 12h4l2-5 4 10 2-5h6',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 20,
  strokeWidth = 1.8,
  ...props
}: SVGProps<SVGSVGElement> & { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Логотип: бирюзовая плитка со срезанным нижним левым углом и линией пульса. */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path
        d="M10 0h12a10 10 0 0 1 10 10v12a10 10 0 0 1-10 10H5a5 5 0 0 1-5-5V10A10 10 0 0 1 10 0Z"
        fill="var(--puls-primary)"
      />
      <path
        d="M5 16.5h5l2.5-6 5 12 2.5-6h5"
        fill="none"
        stroke="var(--puls-on-primary)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
