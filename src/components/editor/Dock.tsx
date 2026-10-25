'use client'

import { Link } from '@payloadcms/ui'
import React, { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { EditorStrings } from '../../utilities/i18n.js'

import classes from './Editor.module.css'
import { CloseIcon, SlidersIcon } from './icons.js'

/** A mode the editor turns on and off - page mode, focus mode, the outline. */
export type DockSwitch = {
  checked: boolean
  /** One line under the label: what the switch does. */
  help: string
  icon: React.ReactNode
  label: string
  /** For tests and styling: `data-payload-live-preview-inspector-dock-item`. */
  name: string
  onChange: () => void
}

/** Somewhere to go, or something to do once - below the switches. */
export type DockAction = ({ href: string; onSelect?: never } | { href?: never; onSelect: () => void }) & {
  icon: React.ReactNode
  label: string
  name: string
}

type Props = {
  actions: DockAction[]
  /** A line beside the closed button, until the editor has done what it says. */
  hint?: string
  strings: EditorStrings
  switches: DockSwitch[]
}

/**
 * The editor's button at the bottom right, and the menu it opens: the modes
 * as switches, with a line each on what they do, and where else to go.
 *
 * Labelled, because the bars hold these as icons only and an icon says
 * little the first time. Over the page rather than in a bar: in page mode
 * the bars are what made room, and on a phone the page is all there is.
 *
 * Payload's colours and nothing of its own, so it sits in any admin. Under
 * Payload's drawers and toasts: a drawer it floated over would hide what the
 * editor opened it for.
 */
export const Dock: React.FC<Props> = ({ actions, hint, strings, switches }) => {
  const [open, setOpen] = useState(false)
  // Into the body, which the server does not have: the document controls this
  // is rendered from are rendered there first.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) {
      return
    }
    // Into the menu, so the keyboard can go on from where the button was.
    rootRef.current?.querySelector<HTMLElement>('[data-payload-live-preview-inspector-dock-item]')?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown, { capture: true })
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown, { capture: true })
    }
  }, [open])

  if (!mounted) {
    return null
  }

  return createPortal(
    <div className={classes.dock} data-payload-live-preview-inspector-dock="" ref={rootRef}>
      {open && (
        <div aria-label={strings.dock} className={classes.dockMenu} id={menuId} role="group">
          {switches.map((item) => (
            <button
              aria-checked={item.checked}
              className={classes.dockItem}
              data-payload-live-preview-inspector-dock-item={item.name}
              key={item.name}
              onClick={item.onChange}
              role="switch"
              type="button"
            >
              <span className={classes.dockItemIcon}>{item.icon}</span>
              <span className={classes.dockItemText}>
                <span className={classes.dockItemLabel}>{item.label}</span>
                <span className={classes.dockItemHelp}>{item.help}</span>
              </span>
              <span aria-hidden="true" className={classes.dockSwitch} />
            </button>
          ))}
          {actions.length > 0 && <div className={classes.dockSeparator} />}
          {actions.map((item) =>
            item.href ? (
              <Link
                className={classes.dockItem}
                data-payload-live-preview-inspector-dock-item={item.name}
                href={item.href}
                key={item.name}
                onClick={() => setOpen(false)}
              >
                <span className={classes.dockItemIcon}>{item.icon}</span>
                <span className={classes.dockItemLabel}>{item.label}</span>
              </Link>
            ) : (
              <button
                className={classes.dockItem}
                data-payload-live-preview-inspector-dock-item={item.name}
                key={item.name}
                onClick={() => {
                  setOpen(false)
                  item.onSelect?.()
                }}
                type="button"
              >
                <span className={classes.dockItemIcon}>{item.icon}</span>
                <span className={classes.dockItemLabel}>{item.label}</span>
              </button>
            ),
          )}
        </div>
      )}
      <div className={classes.dockRow}>
        {hint && !open && (
          <span className={classes.dockHint} role="note">
            {hint}
          </span>
        )}
        <button
          aria-controls={open ? menuId : undefined}
          aria-expanded={open}
          aria-label={strings.dock}
          className={classes.dockButton}
          data-payload-live-preview-inspector-dock-button=""
          onClick={() => setOpen(!open)}
          title={strings.dock}
          type="button"
        >
          {open ? <CloseIcon /> : <SlidersIcon />}
        </button>
      </div>
    </div>,
    document.body,
  )
}
