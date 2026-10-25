import { type BarFold, FOLDED_ATTRIBUTE } from './editorStyles.js'

/**
 * Folds the bar until everything in it fits: the first of `folds`' prefixes -
 * none folded (or the first `least`), the first, the first two, ... - at
 * which the bar does not overflow, or all of them when none does. Every part
 * of the bar keeps its own width (see the editor stylesheet), so too little
 * room shows as overflow rather than as one control drawn over another.
 */
export const foldToFit = (bar: HTMLElement, folds: readonly BarFold[], least = 0): void => {
  for (let count = Math.min(least, folds.length); count <= folds.length; count++) {
    const value = folds.slice(0, count).join(' ')
    if (value) {
      bar.setAttribute(FOLDED_ATTRIBUTE, value)
    } else {
      bar.removeAttribute(FOLDED_ATTRIBUTE)
    }
    if (bar.scrollWidth <= bar.clientWidth) {
      return
    }
  }
}
