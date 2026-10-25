/**
 * The arithmetic behind the editor's layout controls - how far the divider may
 * go, how a device fits the preview - kept apart from the components so it can
 * be held to numbers without a browser.
 */

/** Share of the width the live preview takes when nobody has moved the divider - Payload's own 60/40. */
export const DEFAULT_PREVIEW_SHARE = 0.6

/** Narrowest either side of the divider may get. */
export const MIN_PANE_PX = 320

/** Share of the screen's height the preview takes above the form on a narrow screen. */
export const DEFAULT_PREVIEW_HEIGHT_SHARE = 0.42

/** The narrow layout's preview: never under this share of the height, and never over the second. */
export const PREVIEW_HEIGHT_LIMITS = [0.15, 0.85] as const

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

/**
 * The preview's share of `total` pixels, kept so that neither side is narrower
 * than `minPx`. On a screen too narrow for two such sides it is split evenly.
 */
export const clampPreviewShare = (share: number, total: number, minPx: number = MIN_PANE_PX): number => {
  if (!Number.isFinite(share)) {
    return DEFAULT_PREVIEW_SHARE
  }
  if (total <= minPx * 2) {
    return 0.5
  }
  return clamp(share, minPx / total, 1 - minPx / total)
}

/** The preview's share for a divider dragged to `x`, in a row from `left` that is `width` wide. */
export const previewShareAt = (x: number, left: number, width: number): number =>
  width > 0 ? (left + width - x) / width : DEFAULT_PREVIEW_SHARE

export const clampPreviewHeightShare = (share: number): number =>
  Number.isFinite(share) ? clamp(share, PREVIEW_HEIGHT_LIMITS[0], PREVIEW_HEIGHT_LIMITS[1]) : DEFAULT_PREVIEW_HEIGHT_SHARE

/** A screen to show the page at. */
export type Viewport = {
  /** Shown in the toolbar: a string, or one per language. */
  label?: Record<string, string> | string
  name: string
  /** CSS pixels the page is laid out in. */
  width: number
}

export const DEFAULT_VIEWPORTS: Viewport[] = [
  { name: 'mobile', width: 390 },
  { name: 'tablet', width: 768 },
  { name: 'desktop', width: 1440 },
]

/** What Payload's live preview needs to show a device: its frame size on screen, and its zoom. */
export type DeviceFit = {
  /** On-screen height - the whole panel, so the page shows as much of itself as it can. */
  height: number
  /** On-screen width. */
  width: number
  /** Scale of the page inside; the page is laid out at `width / zoom`, which is the device's width. */
  zoom: number
}

/**
 * Fits a device `deviceWidth` wide into a panel `available` big.
 *
 * Payload's live preview shows a frame `size` big on screen and lays the page
 * out at `size / zoom` - so a device wider than the panel is shrunk to fit
 * rather than cut off, and one that fits is shown at its real size. Only the
 * width is the device's: the height is the panel's, since a page is read by
 * scrolling and a phone-shaped box would only show less of it.
 */
export const fitDevice = (deviceWidth: number, available: { height: number; width: number }): DeviceFit => {
  const width = Math.max(1, Math.floor(available.width))
  return { height: Math.max(1, Math.floor(available.height)), ...shrink(deviceWidth, width) }
}

/**
 * A float for `percent / 100` that gives back exactly `percent` when
 * multiplied by 100 - the quotient itself or one of its nearest neighbours -
 * or `null` for the few percentages no float near them does (55-58 among them).
 */
export const exactPercent = (percent: number): null | number => {
  const value = new Float64Array([percent / 100])
  const bits = new BigInt64Array(value.buffer)
  const start = bits[0]
  for (const step of [0n, 1n, -1n, 2n, -2n, 3n, -3n]) {
    bits[0] = start + step
    if (value[0] * 100 === percent) {
      return value[0]
    }
  }
  return null
}

/**
 * The largest whole-percent zoom that fits `deviceWidth` into `width` - whole,
 * and one whose percentage is exact in floating point, because Payload's
 * toolbar prints `zoom * 100` as it is: 0.57 reads "56.99999999999999%".
 */
const shrink = (deviceWidth: number, width: number): { width: number; zoom: number } => {
  if (deviceWidth <= width) {
    return { width: deviceWidth, zoom: 1 }
  }
  let zoom = 0.01
  for (let percent = Math.floor((width / deviceWidth) * 100); percent > 1; percent--) {
    const exact = exactPercent(percent)
    if (exact !== null) {
      zoom = exact
      break
    }
  }
  return {
    // Up, never down: laid out a fraction of a pixel wider than the device
    // still matches its media queries, a fraction narrower would not.
    width: Math.ceil(deviceWidth * zoom),
    zoom,
  }
}

/** The label of `viewport` in `language`, or `fallback`. */
export const viewportLabel = (viewport: Viewport, language: string, fallback: string): string => {
  const { label } = viewport
  if (typeof label === 'string') {
    return label
  }
  if (label) {
    return label[language] ?? label[language.split('-')[0]] ?? label.en ?? fallback
  }
  return fallback
}

/**
 * A remembered choice, per browser. Read defensively: storage can be off, full
 * or hold something an older version wrote.
 */
export const readStored = <T>(key: string, accept: (value: unknown) => value is T, fallback: T): T => {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) {
      return fallback
    }
    const value: unknown = JSON.parse(raw)
    return accept(value) ? value : fallback
  } catch {
    return fallback
  }
}

export const writeStored = (key: string, value: unknown): void => {
  try {
    if (value === undefined || value === null) {
      window.localStorage.removeItem(key)
    } else {
      window.localStorage.setItem(key, JSON.stringify(value))
    }
  } catch {
    // Private mode, full storage: the choice holds for this visit only.
  }
}

export const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
export const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'
export const isString = (value: unknown): value is string => typeof value === 'string'
export const isNullableString = (value: unknown): value is null | string => value === null || typeof value === 'string'
