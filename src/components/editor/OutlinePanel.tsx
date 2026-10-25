'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'

import type { EditorStrings } from '../../utilities/i18n.js'
import type { Outline, OutlineNode } from '../../utilities/structure.js'

import { chainOf } from '../../utilities/structure.js'
import classes from './Editor.module.css'
import { AlertIcon, ChevronIcon, CloseIcon } from './icons.js'

type Props = {
  /** The row the editor is at - highlighted, and opened up to. */
  activePath: null | string
  /** The row focus mode shows, when it is on. */
  focusRootPath: null | string
  onClose: () => void
  onHover: (node: null | OutlineNode) => void
  onSelect: (node: OutlineNode) => void
  outline: null | Outline
  strings: EditorStrings
}

/** Levels open before the editor opens any: sections and what is directly in them. */
const OPEN_DEPTH = 1

const matches = (node: OutlineNode, query: string): boolean =>
  `${node.label} ${node.summary ?? ''}`.toLowerCase().includes(query)

/**
 * The document's rows as a tree, beside the form: what is on the page, in
 * which order, named the way the form names it - and one click from any of it.
 *
 * A row three sections down is in the tree whether or not Payload has rendered
 * it, because the tree is built from the form state, not from the form.
 * Clicking it opens the way there in the form and selects it in the preview;
 * hovering it marks it in the preview, so the tree and the page can be read
 * against each other.
 *
 * A tree in the ARIA sense: arrow keys move, Right and Left open and close,
 * Enter goes there.
 */
export const OutlinePanel: React.FC<Props> = ({
  activePath,
  focusRootPath,
  onClose,
  onHover,
  onSelect,
  outline,
  strings,
}) => {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const [closed, setClosed] = useState<Set<string>>(() => new Set())
  const [cursor, setCursor] = useState<null | string>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const normalised = query.trim().toLowerCase()

  // The way to the active row stays open, whatever was closed by hand.
  const activeChain = useMemo(
    () => new Set(chainOf(activePath ? outline?.byRowIDPath.get(activePath) : null).map((node) => node.rowIDPath)),
    [activePath, outline],
  )

  const isOpen = (node: OutlineNode): boolean => {
    if (normalised) {
      return true
    }
    if (activeChain.has(node.rowIDPath) && node.rowIDPath !== activePath) {
      return true
    }
    if (open.has(node.rowIDPath)) {
      return true
    }
    if (closed.has(node.rowIDPath)) {
      return false
    }
    return node.depth < OPEN_DEPTH
  }

  /** With a filter: a node shows when it or anything inside it matches. */
  const visibleUnderFilter = useMemo(() => {
    if (!normalised || !outline) {
      return null
    }
    const keep = new Set<string>()
    const visit = (node: OutlineNode): boolean => {
      let any = matches(node, normalised)
      for (const child of node.children) {
        any = visit(child) || any
      }
      if (any) {
        keep.add(node.rowIDPath)
      }
      return any
    }
    for (const group of outline.groups) {
      for (const node of group.nodes) {
        visit(node)
      }
    }
    return keep
  }, [normalised, outline])

  /** The rows on screen, in order - what the arrow keys walk. */
  const flat: OutlineNode[] = []
  const collectVisible = (nodes: OutlineNode[]) => {
    for (const node of nodes) {
      if (visibleUnderFilter && !visibleUnderFilter.has(node.rowIDPath)) {
        continue
      }
      flat.push(node)
      if (node.children.length > 0 && isOpen(node)) {
        collectVisible(node.children)
      }
    }
  }
  for (const group of outline?.groups ?? []) {
    collectVisible(group.nodes)
  }

  const toggle = (node: OutlineNode, to?: boolean) => {
    const next = to ?? !isOpen(node)
    setOpen((previous) => {
      const copy = new Set(previous)
      if (next) {
        copy.add(node.rowIDPath)
      } else {
        copy.delete(node.rowIDPath)
      }
      return copy
    })
    setClosed((previous) => {
      const copy = new Set(previous)
      if (next) {
        copy.delete(node.rowIDPath)
      } else {
        copy.add(node.rowIDPath)
      }
      return copy
    })
  }

  // The active row scrolled into view in the tree, as it changes.
  useEffect(() => {
    if (!activePath) {
      return
    }
    const frame = requestAnimationFrame(() => {
      listRef.current
        ?.querySelector<HTMLElement>(`[data-row-id-path="${CSS.escape(activePath)}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [activePath])

  const focusItem = (path: string) => {
    setCursor(path)
    requestAnimationFrame(() =>
      listRef.current?.querySelector<HTMLElement>(`[data-row-id-path="${CSS.escape(path)}"]`)?.focus(),
    )
  }

  const onKeyDown = (event: React.KeyboardEvent, node: OutlineNode) => {
    const at = flat.indexOf(node)
    switch (event.key) {
      case ' ':
      case 'Enter':
        event.preventDefault()
        onSelect(node)
        return
      case 'ArrowDown':
        event.preventDefault()
        if (flat[at + 1]) {
          focusItem(flat[at + 1].rowIDPath)
        }
        return
      case 'ArrowLeft':
        event.preventDefault()
        if (node.children.length > 0 && isOpen(node)) {
          toggle(node, false)
        } else if (node.parent) {
          focusItem(node.parent.rowIDPath)
        }
        return
      case 'ArrowRight':
        event.preventDefault()
        if (node.children.length > 0 && !isOpen(node)) {
          toggle(node, true)
        } else if (node.children[0]) {
          focusItem(node.children[0].rowIDPath)
        }
        return
      case 'ArrowUp':
        event.preventDefault()
        if (flat[at - 1]) {
          focusItem(flat[at - 1].rowIDPath)
        }
        return
      case 'End':
        event.preventDefault()
        if (flat.length > 0) {
          focusItem(flat[flat.length - 1].rowIDPath)
        }
        return
      case 'Escape':
        event.preventDefault()
        onClose()
        return
      case 'Home':
        event.preventDefault()
        if (flat[0]) {
          focusItem(flat[0].rowIDPath)
        }
        return
    }
  }

  // One item in the tab order: the cursor, else the active row, else the first.
  const tabStop = (cursor && flat.some((node) => node.rowIDPath === cursor) ? cursor : null) ??
    (activePath && flat.some((node) => node.rowIDPath === activePath) ? activePath : null) ??
    flat[0]?.rowIDPath

  const renderNodes = (nodes: OutlineNode[]): React.ReactNode =>
    nodes
      .filter((node) => !visibleUnderFilter || visibleUnderFilter.has(node.rowIDPath))
      .map((node) => {
        const expandable = node.children.length > 0
        const expanded = expandable && isOpen(node)
        return (
          <li key={node.rowIDPath} role="none">
            <div
              aria-current={node.rowIDPath === activePath ? 'true' : undefined}
              aria-expanded={expandable ? expanded : undefined}
              aria-level={node.depth + 1}
              aria-selected={node.rowIDPath === activePath}
              className={[
                classes.item,
                node.rowIDPath === activePath ? classes.itemActive : '',
                node.rowIDPath === focusRootPath ? classes.itemRoot : '',
              ]
                .filter(Boolean)
                .join(' ')}
              data-row-id-path={node.rowIDPath}
              onClick={() => {
                setCursor(node.rowIDPath)
                onSelect(node)
              }}
              onFocus={() => setCursor(node.rowIDPath)}
              onKeyDown={(event) => onKeyDown(event, node)}
              onMouseEnter={() => onHover(node)}
              onMouseLeave={() => onHover(null)}
              role="treeitem"
              style={{ '--depth': node.depth } as React.CSSProperties}
              tabIndex={node.rowIDPath === tabStop ? 0 : -1}
              title={node.summary ? `${node.label} · ${node.summary}` : node.label}
            >
              {expandable ? (
                <button
                  aria-hidden="true"
                  className={[classes.twisty, expanded ? classes.twistyOpen : ''].join(' ')}
                  onClick={(event) => {
                    event.stopPropagation()
                    toggle(node)
                  }}
                  tabIndex={-1}
                  type="button"
                >
                  <ChevronIcon />
                </button>
              ) : (
                <span className={classes.twistySpacer} />
              )}
              <span className={classes.itemLabel}>{node.label}</span>
              {node.summary && <span className={classes.itemSummary}>{node.summary}</span>}
              {node.hasErrors && (
                <span className={classes.itemError}>
                  <AlertIcon />
                </span>
              )}
            </div>
            {expanded && (
              <ul role="group">{renderNodes(node.children)}</ul>
            )}
          </li>
        )
      })

  const empty = !outline || outline.groups.every((group) => group.nodes.length === 0)
  const showGroupLabels = (outline?.groups.length ?? 0) > 1

  return (
    <aside aria-label={strings.outline} className={classes.outline} data-payload-live-preview-inspector-outline="">
      <div className={classes.outlineHeader}>
        <p className={classes.outlineTitle}>{strings.outline}</p>
        <button
          aria-label={strings.outlineHide}
          className={classes.button}
          onClick={onClose}
          title={strings.outlineHide}
          type="button"
        >
          <CloseIcon />
        </button>
      </div>
      {!empty && (
        <input
          aria-label={strings.outlineFilter}
          className={classes.outlineFilter}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && flat[0]) {
              event.preventDefault()
              focusItem(flat[0].rowIDPath)
            }
          }}
          placeholder={strings.outlineFilter}
          type="search"
          value={query}
        />
      )}
      <div className={classes.outlineBody}>
        {empty ? (
          <p className={classes.outlineEmpty}>{strings.outlineEmpty}</p>
        ) : flat.length === 0 ? (
          <p className={classes.outlineEmpty}>{strings.outlineNoMatch}</p>
        ) : (
          <ul aria-label={strings.outline} className={classes.tree} ref={listRef} role="tree">
            {outline?.groups.map((group) =>
              group.nodes.length === 0 ? null : (
                <React.Fragment key={group.fieldPath}>
                  {showGroupLabels && (
                    <li className={classes.outlineGroup} role="none">
                      {group.label}
                    </li>
                  )}
                  {renderNodes(group.nodes)}
                </React.Fragment>
              ),
            )}
          </ul>
        )}
      </div>
    </aside>
  )
}
