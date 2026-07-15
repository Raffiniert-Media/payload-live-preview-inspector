import { describe, expect, it } from 'vitest'

import { encodeStegaPath, findStegaPaths, hasStegaHint, shouldSkipStega, stegaClean } from './stega.js'

describe('encodeStegaPath / findStegaPaths', () => {
  it('round-trips a path through an invisible block', () => {
    const encoded = encodeStegaPath('layout.$abc123.heading')
    expect(findStegaPaths(`Hello${encoded}`)).toEqual(['layout.$abc123.heading'])
  })

  it('produces only zero-width characters', () => {
    // eslint-disable-next-line no-misleading-character-class -- deliberately matching individual zero-width code points
    expect(encodeStegaPath('title')).toMatch(/^[\u200B\u200C\u200D\u2060\uFEFF]+$/)
  })

  it('finds multiple encoded paths in concatenated strings, in order', () => {
    const text = `Hello${encodeStegaPath('title')} - ${encodeStegaPath('subtitle')}World`
    expect(findStegaPaths(text)).toEqual(['title', 'subtitle'])
  })

  it('round-trips non-ASCII paths', () => {
    const path = 'layout.$äöü.heading'
    expect(findStegaPaths(encodeStegaPath(path))).toEqual([path])
  })

  it('returns nothing for plain text', () => {
    expect(findStegaPaths('Hello world')).toEqual([])
  })

  it('ignores a truncated block (delimiter cut off by slice())', () => {
    const encoded = encodeStegaPath('title')
    expect(findStegaPaths(`Hello${encoded.slice(0, -1)}`)).toEqual([])
  })

  it('ignores garbage between delimiters that does not decode to a path', () => {
    // A single digit is not a multiple of 4 - not a valid block.
    expect(findStegaPaths('\uFEFF\u200B\uFEFF')).toEqual([])
    // An empty block is not a path either.
    expect(findStegaPaths('\uFEFF\uFEFF')).toEqual([])
  })

  it('is not confused by genuine zero-width joiners in emoji', () => {
    const family = '👨\u200D👩\u200D👧'
    expect(findStegaPaths(`${family}${encodeStegaPath('title')}`)).toEqual(['title'])
  })
})

describe('hasStegaHint', () => {
  it('detects the block delimiter', () => {
    expect(hasStegaHint(`x${encodeStegaPath('title')}`)).toBe(true)
    expect(hasStegaHint('plain text')).toBe(false)
  })
})

describe('stegaClean', () => {
  it('restores the original string', () => {
    expect(stegaClean(`Hello${encodeStegaPath('title')}`)).toBe('Hello')
  })

  it('removes dangling half-blocks left by truncation', () => {
    const truncated = `Hello${encodeStegaPath('title')}`.slice(0, -1)
    expect(stegaClean(truncated)).toBe('Hello')
  })

  it('preserves genuine zero-width joiners in emoji', () => {
    const family = '👨\u200D👩\u200D👧'
    expect(stegaClean(`${family}${encodeStegaPath('title')}`)).toBe(family)
  })

  it('cleans strings deeply in plain objects and arrays, leaving other values alone', () => {
    const date = new Date(0)
    const cleaned = stegaClean({
      count: 3,
      createdAt: date,
      layout: [{ heading: `Hi${encodeStegaPath('layout.$a.heading')}` }],
      title: `Hello${encodeStegaPath('title')}`,
    })

    expect(cleaned).toEqual({ count: 3, createdAt: date, layout: [{ heading: 'Hi' }], title: 'Hello' })
    expect(cleaned.createdAt).toBe(date)
  })
})

describe('shouldSkipStega', () => {
  it.each([
    '',
    '   ',
    'https://example.com/page',
    'mailto:hi@example.com',
    '/relative/path',
    'user@example.com',
    '2026-07-15',
    '2026-07-15T10:00:00.000Z',
    '42',
    '-3.14',
    '#ff6b00',
    '3f9d2c1e-8a4b-4c6d-9e0f-1a2b3c4d5e6f',
  ])('skips programmatic-looking value %j', (value) => {
    expect(shouldSkipStega(value)).toBe(true)
  })

  it.each(['Hello world', 'Kontakt', 'A headline with the number 42 in it', 'Visit us at our office'])(
    'encodes rendered-text value %j',
    (value) => {
      expect(shouldSkipStega(value)).toBe(false)
    },
  )
})
