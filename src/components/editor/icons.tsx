import React from 'react'

/**
 * The editor's icons: 16px line drawings in the text colour, so they sit with
 * Payload's own controls in light and dark mode alike. Drawn here rather than
 * taken from `@payloadcms/ui`, whose icon set has no outline, focus or device
 * shapes and whose names are not part of its API.
 */

type IconProps = { className?: string }

const Svg: React.FC<{ children: React.ReactNode } & IconProps> = ({ children, className }) => (
  <svg
    aria-hidden="true"
    className={className}
    fill="none"
    height="16"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.5"
    viewBox="0 0 16 16"
    width="16"
  >
    {children}
  </svg>
)

export const OutlineIcon: React.FC<IconProps> = (props) => (
  <Svg {...props}>
    <path d="M2.5 3.5h4M5 8h4.5M7.5 12.5h6" />
    <path d="M2.5 3.5v9h5M2.5 8H5" />
  </Svg>
)

export const FocusIcon: React.FC<IconProps> = (props) => (
  <Svg {...props}>
    <path d="M2 5.5V3a1 1 0 0 1 1-1h2.5M10.5 2H13a1 1 0 0 1 1 1v2.5M14 10.5V13a1 1 0 0 1-1 1h-2.5M5.5 14H3a1 1 0 0 1-1-1v-2.5" />
    <rect height="5" rx="1" width="5" x="5.5" y="5.5" />
  </Svg>
)

export const PhoneIcon: React.FC<IconProps> = (props) => (
  <Svg {...props}>
    <rect height="12" rx="1.5" width="7" x="4.5" y="2" />
    <path d="M7 11.5h2" />
  </Svg>
)

export const TabletIcon: React.FC<IconProps> = (props) => (
  <Svg {...props}>
    <rect height="12" rx="1.5" width="10" x="3" y="2" />
    <path d="M7 11.5h2" />
  </Svg>
)

export const DesktopIcon: React.FC<IconProps> = (props) => (
  <Svg {...props}>
    <rect height="8.5" rx="1" width="13" x="1.5" y="2.5" />
    <path d="M6 14h4M8 11v3" />
  </Svg>
)

export const ChevronIcon: React.FC<IconProps> = (props) => (
  <Svg {...props}>
    <path d="M6 4l4 4-4 4" />
  </Svg>
)

export const CloseIcon: React.FC<IconProps> = (props) => (
  <Svg {...props}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
)

export const AlertIcon: React.FC<IconProps> = (props) => (
  <Svg {...props}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 5v3.5M8 11h.01" />
  </Svg>
)

export const InfoIcon: React.FC<IconProps> = (props) => (
  <Svg {...props}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 7.5V11M8 5h.01" />
  </Svg>
)
