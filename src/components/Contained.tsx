'use client'

import React from 'react'

type Props = {
  children: React.ReactNode
  /** What stopped, for the console - "the editor", "the preview's inspector". */
  name: string
}

type State = { failed: boolean }

/**
 * Keeps a failure in this plugin the plugin's own: what it renders goes, the
 * page around it carries on.
 *
 * Both halves live inside someone else's page - the editor in Payload's edit
 * view, the inspector in the site the preview shows - and both lean on
 * markup that is not theirs. A Payload release that changes it can make them
 * throw, and an error that reaches the page's own boundary takes the whole
 * page with it: the form gone over a missing toolbar. Caught here, the editor
 * simply is not there, and Payload works exactly as it does without it.
 *
 * Render and effect errors only - that is what React hands a boundary. The
 * plugin's event handlers and observers keep their own failures to the
 * feature they belong to.
 */
export class Contained extends React.Component<Props, State> {
  override state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  override componentDidCatch(error: unknown): void {
    // eslint-disable-next-line no-console -- the one place a site owner can see why the editor went
    console.error(
      `[payload-live-preview-inspector] ${this.props.name} stopped after an error - the page works on without it.`,
      error,
    )
  }

  override render(): React.ReactNode {
    return this.state.failed ? null : this.props.children
  }
}
