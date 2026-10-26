import type { MinimalFormState } from './pathResolution.js'

/**
 * The forms of documents open in drawers, by drawer.
 *
 * Payload renders a drawer's document on the server, and its form is out of
 * reach of whatever opened the drawer. The plugin's own listener is part of
 * that render wherever the collection is registered: inside a drawer it edits
 * nothing, and registers the drawer's form here instead - so a jump into the
 * drawer reads the form's state, as a jump in the page's own form does,
 * rather than guessing from its markup.
 */
export type DrawerForm = {
  dispatchFields: (action: unknown) => void
  getFields: () => MinimalFormState
  /** Whether it has changes not saved yet - Payload's own `modified`. */
  isModified: () => boolean
}

const forms = new Map<string, DrawerForm>()

/** Registers `form` for the drawer `drawerSlug`; returns the way to take it back. */
export const registerDrawerForm = (drawerSlug: string, form: DrawerForm): (() => void) => {
  forms.set(drawerSlug, form)
  return () => {
    if (forms.get(drawerSlug) === form) {
      forms.delete(drawerSlug)
    }
  }
}

/** The form of the document in drawer `drawerSlug`, while there is one and it was registered. */
export const drawerForm = (drawerSlug: string): DrawerForm | undefined => forms.get(drawerSlug)
