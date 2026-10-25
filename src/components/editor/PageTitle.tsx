'use client'

import { Link, useDocumentTitle } from '@payloadcms/ui'
import React from 'react'

import type { EditorStrings } from '../../utilities/i18n.js'

import classes from './Editor.module.css'
import { BackIcon } from './icons.js'

type Props = {
  /** Where "back" goes - the collection's list - and what it is called. */
  back?: { href: string; label: string }
  strings: EditorStrings
}

/**
 * Page mode's title, in the bar with the save buttons: the way back to the
 * list and the document's name - what Payload's header and title bar said,
 * in the one line page mode leaves for them.
 */
export const PageTitle: React.FC<Props> = ({ back, strings }) => {
  const { title } = useDocumentTitle()
  return (
    <div className={classes.pageTitle} data-payload-live-preview-inspector-page-title="">
      {back && (
        <Link
          aria-label={strings.back(back.label)}
          className={classes.pageBack}
          href={back.href}
          title={strings.back(back.label)}
        >
          <BackIcon />
        </Link>
      )}
      {title && (
        <span className={classes.pageTitleText} title={title}>
          {title}
        </span>
      )}
    </div>
  )
}
