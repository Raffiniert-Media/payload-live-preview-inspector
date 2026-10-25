/**
 * Focus mode, in the DOM: everything in the form that is neither the chosen
 * row, nor around it, nor inside it, is set aside.
 *
 * Done to the rendered form rather than to the form's state, because the state
 * has no notion of "shown": a field can only be collapsed or not, and a section
 * collapsed is still a header in a list of twelve. Hiding is also reversible
 * without a trace - nothing Payload owns changes, only an attribute of ours
 * comes and goes - and it leaves the form free to render, validate and save as
 * it always does.
 *
 * Generic on purpose: walking up from the row and hiding every sibling on the
 * way knows nothing about tabs, groups or sidebars, so it works for whatever a
 * site's config nests the row in - and keeps working when Payload's markup
 * changes around it.
 */

/** Set on everything focus mode hides; the editor's stylesheet makes it `display: none`. */
export const HIDDEN_ATTRIBUTE = 'data-payload-live-preview-inspector-hidden'

/**
 * Set on what surrounds the shown row from the outermost row of its way down:
 * the frames, paddings and indents of rows whose own header and siblings are
 * hidden. Flattened by the editor's stylesheet, so the row is not shown three
 * empty boxes deep, a narrower column inside each.
 */
export const AROUND_ATTRIBUTE = 'data-payload-live-preview-inspector-around'

/** Set on the editor's own elements inside the form, which focus mode must never hide. */
export const HOST_ATTRIBUTE = 'data-payload-live-preview-inspector-host'

/**
 * What has to be hidden for only `target` to show within `root`: every sibling
 * of `target` and of each of its ancestors below `root`.
 */
export const siblingsToHide = (root: Element, target: Element): Set<Element> => {
  const hide = new Set<Element>()
  if (target === root || !root.contains(target)) {
    return hide
  }
  for (let node: Element | null = target; node && node !== root; node = node.parentElement) {
    const parent: Element | null = node.parentElement
    if (!parent) {
      break
    }
    for (const sibling of Array.from(parent.children)) {
      if (sibling !== node && !sibling.hasAttribute(HOST_ATTRIBUTE) && sibling.tagName !== 'STYLE') {
        hide.add(sibling)
      }
    }
  }
  return hide
}

/** The elements between `target` and `outermost`, `outermost` included and `target` not. */
export const elementsAround = (target: Element, outermost: Element | null | undefined): Set<Element> => {
  const around = new Set<Element>()
  if (!outermost || outermost === target || !outermost.contains(target)) {
    return around
  }
  for (let node = target.parentElement; node; node = node.parentElement) {
    around.add(node)
    if (node === outermost) {
      break
    }
  }
  return around
}

/** Sets `attribute` on exactly the elements in `want` within `root`, writing only what changes. */
const mark = (root: Element, attribute: string, want: Set<Element>) => {
  for (const el of Array.from(root.querySelectorAll(`[${attribute}]`))) {
    if (!want.has(el)) {
      el.removeAttribute(attribute)
    }
  }
  for (const el of want) {
    if (!el.hasAttribute(attribute)) {
      el.setAttribute(attribute, '')
    }
  }
}

/**
 * Shows only `target` (and what surrounds it) within `root`, or everything when
 * `target` is `null`. With `flattenFrom` - the outermost row on the way to
 * `target` - the rows around it lose their frames too (see `AROUND_ATTRIBUTE`).
 * Touches only what changes, so applying the same thing again - on every
 * render of the form - writes nothing.
 *
 * Returns whether anything is hidden now.
 */
export const isolate = (root: Element, target: Element | null, flattenFrom?: Element | null): boolean => {
  const hide = target ? siblingsToHide(root, target) : new Set<Element>()
  mark(root, HIDDEN_ATTRIBUTE, hide)
  mark(root, AROUND_ATTRIBUTE, target ? elementsAround(target, flattenFrom) : new Set())
  return hide.size > 0
}
