// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'

import {
  applyCaretHint,
  buildCollapsedIndex,
  caretHintFromPoint,
  collapsedOffsetAt,
  parseCaretHint,
} from './caret.js'
import { encodeStegaPath } from './stega.js'

beforeEach(() => {
  document.body.innerHTML = ''
})

/** Stubs the point → text position lookup, which needs a real layout engine. */
const stubCaretFromPoint = (node: Node, offset: number): void => {
  Object.assign(document, { caretPositionFromPoint: () => ({ offset, offsetNode: node }) })
}

describe('buildCollapsedIndex', () => {
  it('collapses whitespace across inline elements and text nodes', () => {
    document.body.innerHTML = '<p>  Hello\n   <strong>brave</strong>\tworld  </p>'

    const { text } = buildCollapsedIndex(document.querySelector('p')!)

    expect(text).toBe('Hello brave world')
  })

  it('skips stega blocks without shifting the raw offsets it reports', () => {
    const p = document.createElement('p')
    p.append(document.createTextNode(`Hello${encodeStegaPath('body.root.children.0')} world`))
    document.body.append(p)

    const index = buildCollapsedIndex(p)
    const [node] = [p.firstChild as Text]

    expect(index.text).toBe('Hello world')
    // The collapsed 'w' maps back past the invisible block, to the raw string.
    expect(node.data[index.positions[6].offset]).toBe('w')
  })

  it('ignores script and style content', () => {
    document.body.innerHTML = '<div><style>p{color:red}</style>Visible<script>var x = 1</script></div>'

    expect(buildCollapsedIndex(document.querySelector('div')!).text).toBe('Visible')
  })

  it('records one position per character plus a sentinel past the last one', () => {
    document.body.innerHTML = '<p>Hi</p>'
    const p = document.querySelector('p')!

    const index = buildCollapsedIndex(p)

    expect(index.text).toBe('Hi')
    expect(index.positions).toHaveLength(3)
    expect(index.positions[2]).toEqual({ node: p.firstChild, offset: 2 })
  })

  it('returns an empty index for an element without text', () => {
    document.body.innerHTML = '<p><img alt="x"></p>'

    expect(buildCollapsedIndex(document.querySelector('p')!)).toEqual({ positions: [], text: '' })
  })
})

describe('collapsedOffsetAt', () => {
  it('round-trips a DOM position through the collapsed text', () => {
    document.body.innerHTML = '<p>Hello <strong>brave</strong> world</p>'
    const p = document.querySelector('p')!
    const index = buildCollapsedIndex(p)
    const strongText = p.querySelector('strong')!.firstChild as Text

    // 'brave' starts at collapsed offset 6; its third character is 'a'.
    const offset = collapsedOffsetAt(index, strongText, 2)

    expect(offset).toBe(8)
    expect(index.text[offset!]).toBe('a')
  })

  it('lands on the next rendered position when the node itself collapsed away', () => {
    document.body.innerHTML = '<p>Hello<span>   </span>world</p>'
    const p = document.querySelector('p')!
    const index = buildCollapsedIndex(p)
    const whitespaceOnly = p.querySelector('span')!.firstChild as Text

    const offset = collapsedOffsetAt(index, whitespaceOnly, 1)

    expect(index.text).toBe('Hello world')
    // The collapsed space stands in for the whole run, and resolves back to
    // the position right before the next rendered character.
    expect(index.text[offset!]).toBe(' ')
    expect(index.positions[offset!]).toEqual({ node: p.lastChild, offset: 0 })
  })

  it('returns null for an empty index', () => {
    document.body.innerHTML = '<p></p>'
    const p = document.querySelector('p')!

    expect(collapsedOffsetAt(buildCollapsedIndex(p), p, 0)).toBeNull()
  })
})

describe('caretHintFromPoint', () => {
  it('describes the clicked position relative to the nearest block', () => {
    document.body.innerHTML = '<p>Hello <strong data-tagged>brave</strong> world</p>'
    const strong = document.querySelector('strong')!
    strong.style.display = 'inline'
    stubCaretFromPoint(strong.firstChild!, 2)

    // The tagged element is the inline <strong>, but the context must be the
    // whole paragraph - a single word is far too weak an anchor.
    expect(caretHintFromPoint(document, 0, 0, strong)).toEqual({ offset: 8, text: 'Hello brave world' })
  })

  it('returns null when the caret is outside the tagged element', () => {
    document.body.innerHTML = '<p>Tagged</p><p id="other">Elsewhere</p>'
    const [tagged, other] = Array.from(document.querySelectorAll('p'))
    stubCaretFromPoint(other.firstChild!, 3)

    expect(caretHintFromPoint(document, 0, 0, tagged)).toBeNull()
  })

  it('returns null when the point is not on text at all', () => {
    document.body.innerHTML = '<p>Tagged</p>'
    const p = document.querySelector('p')!
    stubCaretFromPoint(p, 0)

    expect(caretHintFromPoint(document, 0, 0, p)).toBeNull()
  })

  it('windows long text around the caret and shifts the offset with it', () => {
    const long = 'word '.repeat(100).trim()
    document.body.innerHTML = `<p>${long}</p>`
    const p = document.querySelector('p')!
    stubCaretFromPoint(p.firstChild!, 302)

    const hint = caretHintFromPoint(document, 0, 0, p)!

    expect(hint.text).toHaveLength(240)
    expect(hint.offset).toBe(120)
    expect(long.slice(302 - 120, 302 + 120)).toBe(hint.text)
  })
})

describe('applyCaretHint', () => {
  it('selects the clicked position inside a contenteditable', () => {
    document.body.innerHTML =
      '<div data-field-path="body"><div contenteditable="true"><p>Hello <strong>brave</strong> world</p></div></div>'
    const field = document.querySelector<HTMLElement>('[data-field-path="body"]')!

    const caretEl = applyCaretHint(field, { offset: 8, text: 'Hello brave world' })

    const selection = window.getSelection()!
    expect(caretEl).toBe(document.querySelector('strong'))
    expect(selection.anchorNode).toBe(document.querySelector('strong')!.firstChild)
    expect(selection.anchorOffset).toBe(2)
    expect(selection.isCollapsed).toBe(true)
  })

  it('matches text the editor renders with different markup and whitespace', () => {
    document.body.innerHTML =
      '<div contenteditable="true"><p><span>Hello</span>\n  <em>brave</em>   <span>world</span></p></div>'
    const editable = document.querySelector<HTMLElement>('[contenteditable="true"]')!

    // The hint came from a preview that rendered the same sentence as one run.
    const caretEl = applyCaretHint(editable, { offset: 13, text: 'Hello brave world' })

    expect(caretEl).toBe(document.querySelectorAll('span')[1])
    expect(window.getSelection()!.anchorOffset).toBe(1)
  })

  it('focuses the innermost editable when the caret lands in a nested editor', () => {
    document.body.innerHTML =
      '<div contenteditable="true"><p>Outer text</p><div contenteditable="true" id="inner"><p>Nested block text</p></div></div>'
    const outer = document.querySelector<HTMLElement>('[contenteditable="true"]')!

    applyCaretHint(outer, { offset: 7, text: 'Nested block text' })

    expect(document.activeElement).toBe(document.getElementById('inner'))
  })

  it('places the caret at the clicked character of a text input', () => {
    document.body.innerHTML = '<div id="field"><input type="text" value="Hello Live Preview"></div>'
    const input = document.querySelector('input')!

    const caretEl = applyCaretHint(document.getElementById('field')!, { offset: 6, text: 'Hello Live Preview' })

    expect(caretEl).toBe(input)
    expect(input.selectionStart).toBe(6)
    expect(input.selectionEnd).toBe(6)
  })

  it('returns null for a non-text input, so the caller just focuses it', () => {
    document.body.innerHTML = '<div id="field"><input type="checkbox"></div>'

    expect(applyCaretHint(document.getElementById('field')!, { offset: 0, text: 'anything' })).toBeNull()
  })

  it('returns null when the text is no longer in the field', () => {
    document.body.innerHTML = '<div contenteditable="true"><p>Something else entirely</p></div>'
    const editable = document.querySelector<HTMLElement>('[contenteditable="true"]')!

    expect(applyCaretHint(editable, { offset: 3, text: 'Hello brave world' })).toBeNull()
  })
})

describe('parseCaretHint', () => {
  it('accepts a well-formed hint', () => {
    expect(parseCaretHint({ offset: 3, text: 'Hello' })).toEqual({ offset: 3, text: 'Hello' })
  })

  it('rejects anything else', () => {
    for (const value of [null, undefined, 'Hello', { text: 'Hello' }, { offset: 3 }, { offset: -1, text: 'x' }, { offset: 1.5, text: 'x' }]) {
      expect(parseCaretHint(value)).toBeUndefined()
    }
  })
})
