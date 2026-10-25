import { describe, expect, it } from 'vitest'

import {
  clampPreviewHeightShare,
  clampPreviewShare,
  DEFAULT_PREVIEW_SHARE,
  exactPercent,
  fitDevice,
  MIN_PANE_PX,
  previewShareAt,
  viewportLabel,
} from './layout.js'

describe('clampPreviewShare', () => {
  it('keeps both sides at least MIN_PANE_PX wide', () => {
    // 1440 wide: 320/1440 = 0.222 is the least either side gets.
    expect(clampPreviewShare(0.05, 1440)).toBeCloseTo(MIN_PANE_PX / 1440)
    expect(clampPreviewShare(0.99, 1440)).toBeCloseTo(1 - MIN_PANE_PX / 1440)
    expect(clampPreviewShare(0.55, 1440)).toBe(0.55)
  })

  it('splits evenly where two sides cannot both fit', () => {
    expect(clampPreviewShare(0.9, 600)).toBe(0.5)
  })

  it('takes the default for something that is not a number', () => {
    expect(clampPreviewShare(Number.NaN, 1440)).toBe(DEFAULT_PREVIEW_SHARE)
  })
})

describe('previewShareAt', () => {
  it('is the part of the row right of the pointer', () => {
    // A row from 0 to 1440, the divider dragged to 576: Payload's 40/60.
    expect(previewShareAt(576, 0, 1440)).toBeCloseTo(0.6)
    // Offset by an open nav of 240.
    expect(previewShareAt(240 + 600, 240, 1200)).toBeCloseTo(0.5)
  })
})

describe('clampPreviewHeightShare', () => {
  it('never hides either half on a narrow screen', () => {
    expect(clampPreviewHeightShare(0)).toBe(0.15)
    expect(clampPreviewHeightShare(1)).toBe(0.85)
    expect(clampPreviewHeightShare(0.5)).toBe(0.5)
  })
})

describe('fitDevice', () => {
  it('shrinks a device wider than the panel to fit, laid out at its own width', () => {
    const fit = fitDevice(1440, { height: 780, width: 824 })
    // 57% would fit, but 0.57 * 100 prints as 56.99999999999999 in Payload's
    // toolbar; 54% is the largest that reads as itself.
    expect(fit.zoom).toBe(0.54)
    expect(fit.zoom * 100).toBe(54)
    // Payload lays the page out at width / zoom: the device's width, to the
    // pixel and never under it - a `min-width: 1440px` rule has to apply.
    expect(Math.floor(fit.width / fit.zoom)).toBe(1440)
    expect(fit.width).toBeLessThanOrEqual(824)
    expect(fit.height).toBe(780)
  })

  it('shows a device that fits at its real size', () => {
    expect(fitDevice(390, { height: 780, width: 824 })).toEqual({ height: 780, width: 390, zoom: 1 })
  })

  it('survives a panel that has not been measured yet', () => {
    const fit = fitDevice(390, { height: 0, width: 0 })
    expect(fit.width).toBeGreaterThan(0)
    expect(fit.height).toBeGreaterThan(0)
  })
})

describe('exactPercent', () => {
  it('finds a float that prints as the whole percentage it stands for', () => {
    for (const percent of [33, 50, 54, 63, 64, 99]) {
      expect((exactPercent(percent) as number) * 100).toBe(percent)
    }
  })

  it('admits where there is none', () => {
    expect(exactPercent(57)).toBeNull()
  })
})

describe('viewportLabel', () => {
  it('reads a label per language, then English, then the fallback', () => {
    expect(viewportLabel({ name: 'mobile', label: { de: 'Handy', en: 'Phone' }, width: 390 }, 'de', 'x')).toBe('Handy')
    expect(viewportLabel({ name: 'mobile', label: { en: 'Phone' }, width: 390 }, 'fr', 'x')).toBe('Phone')
    expect(viewportLabel({ name: 'mobile', width: 390 }, 'de', 'Handy')).toBe('Handy')
  })
})
