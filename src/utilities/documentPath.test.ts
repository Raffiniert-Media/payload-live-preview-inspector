import { describe, expect, it } from 'vitest'

import { documentSegment, isDocumentPath, parseDocumentPath } from './pathAttribute.js'

describe('a path into another document', () => {
  it('names the document first, and the field after it', () => {
    expect(documentSegment({ id: 12, collection: 'posts' })).toBe('@posts:12')
    expect(parseDocumentPath('@posts:12.title')).toEqual({ id: 12, collection: 'posts', path: 'title' })
    expect(parseDocumentPath('@posts:12')).toEqual({ id: 12, collection: 'posts', path: '' })
    expect(parseDocumentPath('@posts:12.details.subtitle')?.path).toBe('details.subtitle')
  })

  it('keeps a string id a string - "12" and 12 are two documents', () => {
    const segment = documentSegment({ id: '12', collection: 'people' })
    expect(segment).toBe('@people:~12')
    expect(parseDocumentPath(`${segment}.name`)).toEqual({ id: '12', collection: 'people', path: 'name' })
  })

  it('carries any id through, separators and all', () => {
    for (const id of ['a.b', 'a:b', '507f1f77bcf86cd799439011', 'ü ~ (x)', "it's"]) {
      const segment = documentSegment({ id, collection: 'things' })
      expect(segment.split('.')).toHaveLength(1)
      expect(parseDocumentPath(`${segment}.title`)).toEqual({ id, collection: 'things', path: 'title' })
    }
  })

  it('is nobody’s when it is malformed - and the edited document’s own paths are not one', () => {
    for (const path of ['title', 'layout.$abc.heading', '@', '@posts', '@posts:', '@:12', '@posts:abc', '@po.sts:1', '@posts:~%E0%A4%A']) {
      expect(parseDocumentPath(path)).toBeNull()
      expect(isDocumentPath(path)).toBe(false)
    }
    expect(isDocumentPath('@posts:12.title')).toBe(true)
  })
})
