/**
 * What the editor's own controls say, in the admin's language.
 *
 * German and English, picked by the admin's `i18n.language`, English for
 * anything else. Kept in the package rather than in Payload's translation
 * config because a plugin that adds keys there has to be registered before the
 * admin's own `i18n` - and the preview, which shows the block toolbar, has no
 * translation system at all: the admin sends it the strings it needs.
 */

export type EditorStrings = {
  addBelow: string
  /** First crumb of the path: the whole document. */
  allFields: string
  duplicate: string
  /** A block the editor duplicated. */
  duplicated: (label: string) => string
  editHere: string
  focusMode: string
  focusModeOff: string
  focusModeOn: string
  hint: string
  hintModifier: (key: string) => string
  /** A block the editor moved. */
  moved: (label: string) => string
  moveDown: string
  moveUp: string
  notFound: string
  notInForm: string
  outline: string
  outlineEmpty: string
  outlineFilter: string
  outlineHide: string
  outlineNoMatch: string
  outlineShow: string
  /** The path bar's own name, for assistive technology. */
  path: string
  previewHeight: string
  remove: string
  /** A block the editor removed. */
  removed: (label: string) => string
  resizeSplit: string
  selectParent: string
  undo: string
  viewport: string
  viewportDesktop: string
  viewportFit: string
  viewportMobile: string
  viewportTablet: string
}

/** The subset the preview shows - plain strings, so they survive `postMessage`. */
export type PreviewStrings = Pick<
  EditorStrings,
  'addBelow' | 'duplicate' | 'editHere' | 'moveDown' | 'moveUp' | 'notInForm' | 'remove' | 'selectParent'
>

const en: EditorStrings = {
  addBelow: 'Add below',
  allFields: 'All fields',
  duplicate: 'Duplicate',
  duplicated: (label) => `${label} duplicated`,
  editHere: 'Edit',
  focusMode: 'Focus',
  focusModeOff: 'Focus mode is on: only the selected block is shown. Click to show every field again.',
  focusModeOn: 'Focus mode: show only the selected block',
  hint: 'Click an element in the Live Preview to jump to its field',
  hintModifier: (key) => ` — hold ${key} to use the page instead`,
  moved: (label) => `${label} moved`,
  moveDown: 'Move down',
  moveUp: 'Move up',
  notFound: 'That element’s field isn’t in this form (a removed row, or a field only editable in a drawer)',
  notInForm: 'Not in this form',
  outline: 'Outline',
  outlineEmpty: 'This document has no rows or blocks yet.',
  outlineFilter: 'Filter',
  outlineHide: 'Hide outline',
  outlineNoMatch: 'Nothing matches.',
  outlineShow: 'Show outline',
  path: 'Path',
  previewHeight: 'Drag to change the preview’s height',
  remove: 'Remove',
  removed: (label) => `${label} removed`,
  resizeSplit: 'Drag to resize form and preview, double-click to reset',
  selectParent: 'Select the block around it',
  undo: 'Undo',
  viewport: 'Screen width',
  viewportDesktop: 'Desktop',
  viewportFit: 'Fit to panel',
  viewportMobile: 'Phone',
  viewportTablet: 'Tablet',
}

const de: EditorStrings = {
  addBelow: 'Darunter hinzufügen',
  allFields: 'Alle Felder',
  duplicate: 'Duplizieren',
  duplicated: (label) => `${label} dupliziert`,
  editHere: 'Bearbeiten',
  focusMode: 'Fokus',
  focusModeOff: 'Fokus ist an: Nur der gewählte Block wird gezeigt. Klicken, um wieder alle Felder zu zeigen.',
  focusModeOn: 'Fokus: nur den gewählten Block zeigen',
  hint: 'Klick in der Vorschau springt zum Feld',
  hintModifier: (key) => ` – mit ${key} bedient man die Seite`,
  moved: (label) => `${label} verschoben`,
  moveDown: 'Nach unten',
  moveUp: 'Nach oben',
  notFound: 'Dieses Element hat kein Feld in diesem Formular (eine entfernte Zeile oder ein Feld, das nur im Seitenfenster bearbeitet wird)',
  notInForm: 'Nicht in diesem Formular',
  outline: 'Gliederung',
  outlineEmpty: 'Dieses Dokument hat noch keine Zeilen oder Blöcke.',
  outlineFilter: 'Filtern',
  outlineHide: 'Gliederung ausblenden',
  outlineNoMatch: 'Nichts gefunden.',
  outlineShow: 'Gliederung zeigen',
  path: 'Pfad',
  previewHeight: 'Ziehen, um die Höhe der Vorschau zu ändern',
  remove: 'Entfernen',
  removed: (label) => `${label} entfernt`,
  resizeSplit: 'Ziehen, um Formular und Vorschau zu verteilen, Doppelklick setzt zurück',
  selectParent: 'Den umgebenden Block wählen',
  undo: 'Rückgängig',
  viewport: 'Bildschirmbreite',
  viewportDesktop: 'Desktop',
  viewportFit: 'An die Fläche anpassen',
  viewportMobile: 'Handy',
  viewportTablet: 'Tablet',
}

export const stringsFor = (language: string | undefined): EditorStrings =>
  language?.toLowerCase().startsWith('de') ? de : en

export const previewStringsOf = (strings: EditorStrings): PreviewStrings => ({
  addBelow: strings.addBelow,
  duplicate: strings.duplicate,
  editHere: strings.editHere,
  moveDown: strings.moveDown,
  moveUp: strings.moveUp,
  notInForm: strings.notInForm,
  remove: strings.remove,
  selectParent: strings.selectParent,
})

/** A config label in the admin's language: a string, or a record of translations. */
export const translateLabel = (label: unknown, language: string): string | undefined => {
  if (typeof label === 'string') {
    return label || undefined
  }
  if (label && typeof label === 'object') {
    const translations = label as Record<string, unknown>
    const text = translations[language] ?? translations[language.split('-')[0]] ?? translations.en ?? Object.values(translations)[0]
    return typeof text === 'string' ? text : undefined
  }
  return undefined
}

/** `metaDescription` → `Meta Description`, the way Payload labels an unlabelled field. */
export const humanize = (name: string): string =>
  name
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (first) => first.toUpperCase())
