import { PAYLOAD_CLASS } from '../../utilities/payloadAdmin.js'

/** On the field whose whole description shows - see `compactDescriptionStyles`. */
export const DESCRIPTION_OPEN_ATTRIBUTE = 'data-payload-live-preview-inspector-description-open'

/**
 * Which field shows its whole description: the one with focus - but closed
 * only once a click has happened, not when it starts.
 *
 * `:focus-within` did this in CSS and closed the description on mousedown,
 * where focus moves. Everything below a long description moved up before the
 * mouse came back up, and the click landed on whatever was now under the
 * pointer - the first click on a section after typing a title did nothing. So
 * focus is followed here, and a field that loses it while a button is down
 * keeps its description until the click has been dispatched.
 */
export const holdOpenDescription = (doc: Document): (() => void) => {
  let current: Element | null = null
  let pressed = false
  const leaving = new Set<Element>()

  const close = (field: Element) => {
    if (pressed) {
      leaving.add(field)
    } else {
      field.removeAttribute(DESCRIPTION_OPEN_ATTRIBUTE)
    }
  }

  const onFocusIn = (event: FocusEvent) => {
    const field = event.target instanceof Element ? event.target.closest(`.${PAYLOAD_CLASS.fieldType}`) : null

    if (field === current) {
      return
    }
    if (current) {
      close(current)
    }
    current = field
    if (field) {
      leaving.delete(field)
      field.setAttribute(DESCRIPTION_OPEN_ATTRIBUTE, '')
    }
  }

  const onFocusOut = (event: FocusEvent) => {
    const next = event.relatedTarget

    if (current && !(next instanceof Node && current.contains(next))) {
      close(current)
      current = null
    }
  }

  const onPointerDown = () => {
    pressed = true
  }

  // After the click: it is dispatched right after `pointerup`, in the same task.
  const onPointerUp = () => {
    pressed = false
    setTimeout(() => {
      for (const field of leaving) {
        if (field !== current) {
          field.removeAttribute(DESCRIPTION_OPEN_ATTRIBUTE)
        }
      }
      leaving.clear()
    }, 0)
  }

  doc.addEventListener('focusin', onFocusIn)
  doc.addEventListener('focusout', onFocusOut)
  doc.addEventListener('pointerdown', onPointerDown, { capture: true })
  doc.addEventListener('pointerup', onPointerUp, { capture: true })
  doc.addEventListener('pointercancel', onPointerUp, { capture: true })

  return () => {
    doc.removeEventListener('focusin', onFocusIn)
    doc.removeEventListener('focusout', onFocusOut)
    doc.removeEventListener('pointerdown', onPointerDown, { capture: true })
    doc.removeEventListener('pointerup', onPointerUp, { capture: true })
    doc.removeEventListener('pointercancel', onPointerUp, { capture: true })
    for (const field of doc.querySelectorAll(`[${DESCRIPTION_OPEN_ATTRIBUTE}]`)) {
      field.removeAttribute(DESCRIPTION_OPEN_ATTRIBUTE)
    }
  }
}
