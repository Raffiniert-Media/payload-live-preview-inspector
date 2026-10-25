import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  collapsibleIDFromPath,
  FIELD_ID_PREFIX,
  FIELD_PATH_ATTRIBUTE,
  fieldIDFromPath,
  pathFromRowID,
  PAYLOAD_CLASS,
  PAYLOAD_PROPERTY,
  rowIDFromPath,
  SCROLL_ID_PREFIX,
} from './payloadAdmin.js'

/**
 * Every name in `payloadAdmin.ts`, held against the `@payloadcms/ui` that is
 * installed.
 *
 * These are Payload's implementation, not its API, so a Payload release can
 * rename any of them without a word in its changelog - and the plugin would not
 * fail, it would find nothing: a click that reveals no field, a divider that
 * never appears. This is where such an upgrade is meant to show up instead, one
 * failing name at a time.
 *
 * Read from the package's built output rather than imported: the names live in
 * class strings and stylesheets, and a BEM modifier is usually only ever
 * assembled (`${baseClass}--collapsed`), never written out - so a name passes
 * when its stylesheet has it, or when a script both defines its block and
 * appends its suffix.
 */

const require = createRequire(import.meta.url)

/** `entry` for a package without a main export - `@payloadcms/next` has only subpaths. */
const packageRoot = (name: string, entry: string = name): string => {
  let dir = path.dirname(require.resolve(entry))
  while (
    !fs.existsSync(path.join(dir, 'package.json')) ||
    !fs.readFileSync(path.join(dir, 'package.json'), 'utf8').includes(`"name": "${name}"`)
  ) {
    const parent = path.dirname(dir)
    if (parent === dir) {
      throw new Error(`${name} is not installed`)
    }
    dir = parent
  }
  return dir
}

const filesUnder = (dir: string, extension: string): string[] =>
  fs.readdirSync(dir, { recursive: true, withFileTypes: true }).flatMap((entry) =>
    entry.isFile() && entry.name.endsWith(extension) ? [path.join(entry.parentPath, entry.name)] : [],
  )

const root = packageRoot('@payloadcms/ui')
/*
 * `@payloadcms/next` too: it renders the edit view's frame - the document's
 * title bar among it - around what `@payloadcms/ui` draws inside.
 */
const dists = [root, packageRoot('@payloadcms/next', '@payloadcms/next/views')].map((dir) => path.join(dir, 'dist'))
const css = dists
  .flatMap((dist) => filesUnder(dist, '.css').concat(filesUnder(dist, '.scss')))
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n')
const scripts = dists.flatMap((dist) => filesUnder(dist, '.js')).map((file) => fs.readFileSync(file, 'utf8'))

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const asWord = (name: string): RegExp => new RegExp(`(^|[^\\w-])${escape(name)}(?![\\w-])`)

/** Whether the installed admin uses `name` as a class - written out, or built from its block and suffix. */
const usesClass = (name: string): boolean => {
  if (asWord(name).test(css) || scripts.some((script) => asWord(name).test(script))) {
    return true
  }
  // `block__element` or `block--modifier`: split at the first of either.
  const at = [name.indexOf('__'), name.indexOf('--')].filter((index) => index > 0).sort((a, b) => a - b)[0]
  if (at === undefined) {
    return false
  }
  const block = name.slice(0, at)
  const suffix = name.slice(at)
  const defined = new RegExp(`=\\s*['"\`]${escape(block)}['"\`]`)
  // Followed by the end of the name, so `__main-wrap` does not pass on `__main-wrapper`.
  const appended = new RegExp(`\\}${escape(suffix)}(?![\\w-])`)
  return scripts.some((script) => defined.test(script) && appended.test(script))
}

describe(`the Payload admin this plugin reads (@payloadcms/ui ${JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version})`, () => {
  it.each(Object.entries(PAYLOAD_CLASS))('still has the class %s (%s)', (_key, name) => {
    expect(
      usesClass(name),
      `".${name}" is gone from @payloadcms/ui and @payloadcms/next - update PAYLOAD_CLASS in payloadAdmin.ts`,
    ).toBe(true)
  })

  it.each(Object.entries(PAYLOAD_PROPERTY))('still sets the custom property %s (%s)', (_key, name) => {
    expect(css.includes(`${name}:`) || scripts.some((script) => script.includes(name)), `${name} is gone`).toBe(true)
  })

  it('still identifies a field by its id, built from its path', () => {
    // `field-${path.replace(/\./g, '__')}` in the field components.
    expect(scripts.some((script) => script.includes(`${FIELD_ID_PREFIX}\${`) && script.includes("'__'"))).toBe(true)
    expect(fieldIDFromPath('layout.2.heading')).toBe('field-layout__2__heading')
  })

  it('still identifies a row by its wrapper id, built from its path and index', () => {
    expect(scripts.some((script) => script.includes('-row-${'))).toBe(true)
    expect(rowIDFromPath('layout.2.rows.0')).toBe('layout-2-rows-row-0')
    expect(pathFromRowID('layout-2-rows-row-0')).toBe('layout.2.rows.0')
  })

  it('still gives an array row header a second, scroll-only id', () => {
    expect(scripts.some((script) => script.includes(`${SCROLL_ID_PREFIX}\${`) && script.includes('-row-'))).toBe(true)
    expect(pathFromRowID(`${SCROLL_ID_PREFIX}r1-row-0`)).toBeNull()
  })

  it('still names a collapsible field by its unnamed path', () => {
    // `field-${fieldPreferencesKey}`, the key being `collapsible-${path…}`.
    expect(scripts.some((script) => script.includes('`collapsible-${') && script.includes(`${FIELD_ID_PREFIX}\${`))).toBe(
      true,
    )
    expect(collapsibleIDFromPath('_index-0-1')).toBe('field-collapsible-_index-0-1')
  })
})

describe('the rich-text editor this plugin reads', () => {
  /*
   * Lexical's field renders no `field-<path>` id, only this attribute. Not a
   * dependency of the plugin - a site without rich text never needs it - so
   * this checks whichever editor the repository has installed.
   */
  it('still marks a rich-text field with its path', () => {
    const lexical = path.join(packageRoot('@payloadcms/richtext-lexical'), 'dist')
    const found = filesUnder(lexical, '.js').some((file) => fs.readFileSync(file, 'utf8').includes(FIELD_PATH_ATTRIBUTE))
    expect(found, `${FIELD_PATH_ATTRIBUTE} is gone from @payloadcms/richtext-lexical`).toBe(true)
  })
})
