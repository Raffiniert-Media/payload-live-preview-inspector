/**
 * Steganographic path encoding: `inspectable(data, { stega: true })` appends
 * a field's path to its string value as a run of zero-width (invisible)
 * characters. `LivePreviewInspectorClient`'s scanner then decodes those runs
 * from the rendered DOM inside the Live Preview iframe and tags the
 * containing elements automatically - no `pathOf()` needed for text content.
 */

/**
 * The four zero-width characters used as base-4 digits (2 bits each):
 * ZERO WIDTH SPACE, ZERO WIDTH NON-JOINER, ZERO WIDTH JOINER, WORD JOINER.
 */
const DIGITS = ['\u200B', '\u200C', '\u200D', '\u2060'] as const

const DIGIT_VALUES: Record<string, number> = {
  '\u200B': 0,
  '\u200C': 1,
  '\u200D': 2,
  '\u2060': 3,
}

/**
 * Every encoded block is wrapped in U+FEFF (ZERO WIDTH NO-BREAK SPACE) on
 * both sides, so the decoder (and `stegaClean`) anchor on it - a lone
 * zero-width joiner in real content (e.g. inside a family emoji) is never
 * mistaken for, or stripped as, encoded data.
 */
const DELIMITER = '\uFEFF'

/** Encodes `path` as an invisible character block to append to a string value. */
export const encodeStegaPath = (path: string): string => {
  const bytes = new TextEncoder().encode(path)
  let digits = ''

  for (const byte of bytes) {
    digits += DIGITS[(byte >> 6) & 3] + DIGITS[(byte >> 4) & 3] + DIGITS[(byte >> 2) & 3] + DIGITS[byte & 3]
  }

  return `${DELIMITER}${digits}${DELIMITER}`
}

const decodeStegaDigits = (digits: string): null | string => {
  if (digits.length === 0 || digits.length % 4 !== 0) {
    return null
  }

  const bytes = new Uint8Array(digits.length / 4)

  for (let i = 0; i < bytes.length; i++) {
    let byte = 0
    for (let j = 0; j < 4; j++) {
      byte = (byte << 2) | DIGIT_VALUES[digits[i * 4 + j]]
    }
    bytes[i] = byte
  }

  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return decoded.length > 0 ? decoded : null
  } catch {
    return null
  }
}

/** Cheap prefilter: can `text` possibly contain an encoded block? */
export const hasStegaHint = (text: string): boolean => text.includes(DELIMITER)

/** Decodes all paths encoded into `text`, in order of appearance. */
export const findStegaPaths = (text: string): string[] => {
  if (!hasStegaHint(text)) {
    return []
  }

  const paths: string[] = []

  // eslint-disable-next-line no-misleading-character-class -- matching individual zero-width code points is the whole point here
  for (const match of text.matchAll(/\uFEFF([\u200B\u200C\u200D\u2060]*)\uFEFF/g)) {
    const path = decodeStegaDigits(match[1])
    if (path) {
      paths.push(path)
    }
  }

  return paths
}

/**
 * Strips encoded path blocks from a string, or deeply from every string in a
 * plain object/array tree (other values pass through untouched). Use this
 * wherever you need the raw value of a stega-encoded string - comparisons,
 * `new Date()`, sending data to an API, and so on. Dangling half-blocks
 * (e.g. after the value was truncated with `slice()`) are stripped too.
 * Genuine zero-width characters outside an encoded block (emoji joiners) are
 * preserved.
 */
export const stegaClean = <T>(value: T): T => {
  if (typeof value === 'string') {
    // eslint-disable-next-line no-misleading-character-class -- matching individual zero-width code points is the whole point here
    return value.replace(/\uFEFF[\u200B\u200C\u200D\u2060]*\uFEFF?/g, '') as T
  }

  if (Array.isArray(value)) {
    return value.map((item) => stegaClean(item)) as T
  }

  if (value !== null && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value)
    // Leave class instances (Date, etc.) alone - only walk plain data.
    if (proto !== Object.prototype && proto !== null) {
      return value
    }

    const cleaned: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      cleaned[key] = stegaClean(item)
    }
    return cleaned as T
  }

  return value
}

const SKIP_PATTERNS: RegExp[] = [
  /^\s*$/, // empty / whitespace-only
  /^(?:https?:|mailto:|tel:)/i, // absolute URLs
  /^\/\S*$/, // relative URL paths
  /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/, // email addresses
  /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/, // ISO dates/datetimes
  /^-?\d+(?:[.,]\d+)?$/, // numeric strings
  /^#[0-9a-f]{3,8}$/i, // hex colors
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // uuids
]

/**
 * Values that are likely compared or parsed programmatically rather than
 * rendered as text - encoding them would break `===`, `new Date()`, `href`s
 * etc., so `inspectable()`'s stega mode leaves them raw.
 */
export const shouldSkipStega = (value: string): boolean => SKIP_PATTERNS.some((pattern) => pattern.test(value))
