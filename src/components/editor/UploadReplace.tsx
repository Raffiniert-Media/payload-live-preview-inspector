'use client'

import { useListDrawer } from '@payloadcms/ui'
import React, { useEffect, useRef } from 'react'

import type { EditorStrings } from '../../utilities/i18n.js'

import classes from './Editor.module.css'

/** An upload field the editor can put another file into: where it is, and what it may hold. */
export type UploadTarget = {
  /** The element in Payload's file card the button is portalled into. */
  host: HTMLElement
  path: string
  relationTo: string | string[]
}

/**
 * "Replace", beside Payload's own buttons on an upload field that has a file:
 * another file from the library, in one step.
 *
 * Payload's way is two: remove the file, then choose one - and the button
 * that stands out on the card, the pencil, does something else entirely: it
 * opens the file's own document, its alt text and focal point, and a change
 * there changes the image wherever it is used. Asked on a page, "change this
 * image" means this.
 */
export const ReplaceButton: React.FC<{ onClick: () => void; strings: EditorStrings }> = ({ onClick, strings }) => (
  <button
    className={classes.replaceButton}
    data-payload-live-preview-inspector-replace=""
    onClick={onClick}
    title={strings.replaceHelp}
    type="button"
  >
    {strings.replace}
  </button>
)

type DrawerProps = {
  onClose: () => void
  /** The chosen document, as the field stores it: an id, or `{ relationTo, value }` for several collections. */
  onSelect: (value: unknown) => void
  relationTo: string | string[]
}

/**
 * Payload's list drawer for `relationTo`, open from the moment it mounts; it
 * reports a choice, or that it was closed without one.
 */
export const ReplaceDrawer: React.FC<DrawerProps> = ({ onClose, onSelect, relationTo }) => {
  const collectionSlugs = typeof relationTo === 'string' ? [relationTo] : relationTo
  const [ListDrawer, , { closeDrawer, isDrawerOpen, openDrawer }] = useListDrawer({ collectionSlugs })
  const wasOpen = useRef(false)

  useEffect(() => {
    openDrawer()
  }, [openDrawer])

  useEffect(() => {
    if (isDrawerOpen) {
      wasOpen.current = true
    } else if (wasOpen.current) {
      onClose()
    }
  }, [isDrawerOpen, onClose])

  return (
    <ListDrawer
      allowCreate
      onSelect={({ collectionSlug, doc }) => {
        onSelect(typeof relationTo === 'string' ? doc.id : { relationTo: collectionSlug, value: doc.id })
        closeDrawer()
      }}
    />
  )
}
