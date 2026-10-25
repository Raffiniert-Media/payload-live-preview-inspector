import { expect, it } from 'vitest'

import { escapeAttributeValue } from './pathAttribute.js'

/*
 * As strings rather than through `querySelector`: happy-dom's selector parser
 * rejects an escaped quote that every browser accepts. Checked against
 * Chromium by hand when this was written - each of these finds its element.
 */
it('escapes what would end a quoted CSS string - quotes, backslashes, line breaks', () => {
  expect(escapeAttributeValue('layout.0.title')).toBe('layout.0.title')
  expect(escapeAttributeValue('say "hi"')).toBe('say \\"hi\\"')
  expect(escapeAttributeValue('back\\slash')).toBe('back\\\\slash')
  expect(escapeAttributeValue('two\nlines')).toBe('two\\a lines')
  expect(escapeAttributeValue('cr\rand\fform')).toBe('cr\\d and\\c form')
})
