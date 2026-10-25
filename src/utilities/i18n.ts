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
  /** Page mode's way back to the list, which Payload's header otherwise has. */
  back: (list: string) => string
  /** Page mode on a narrow screen: put the form away, the page is all there is again. */
  closeForm: string
  /** The button at the bottom right, for assistive technology. */
  dock: string
  duplicate: string
  /** A block the editor duplicated. */
  duplicated: (label: string) => string
  editHere: string
  focusMode: string
  focusModeHelp: string
  /** Focus mode's name where it stands alone, as a switch. */
  focusModeName: string
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
  /** Page mode on a narrow screen, before anything was tapped: the form with every field. */
  openForm: string
  outline: string
  outlineEmpty: string
  outlineFilter: string
  outlineHelp: string
  outlineHide: string
  outlineNoMatch: string
  outlineShow: string
  pageMode: string
  pageModeHelp: string
  /** The path bar's own name, for assistive technology. */
  path: string
  previewHeight: string
  remove: string
  /** A block the editor removed. */
  removed: (label: string) => string
  replace: string
  replaceHelp: string
  resizeSplit: string
  selectParent: string
  /** Page mode on a narrow screen, until the first tap: what tapping does. */
  tapHint: string
  undo: string
  versions: string
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
  back: (list) => `Back to ${list}`,
  closeForm: 'Close the form',
  dock: 'Editor',
  duplicate: 'Duplicate',
  duplicated: (label) => `${label} duplicated`,
  editHere: 'Edit',
  focusMode: 'Focus',
  focusModeHelp: 'The form shows only the selected block',
  focusModeName: 'Focus mode',
  focusModeOff: 'Focus mode is on: only the selected block is shown. Click to show every field again.',
  focusModeOn: 'Focus mode: show only the selected block',
  hint: 'Click an element in the Live Preview to jump to its field',
  hintModifier: (key) => ` — hold ${key} to use the page instead`,
  moved: (label) => `${label} moved`,
  moveDown: 'Move down',
  moveUp: 'Move up',
  notFound: 'That element’s field isn’t in this form (a removed row, or a field only editable in a drawer)',
  notInForm: 'Not in this form',
  openForm: 'Open the form',
  outline: 'Outline',
  outlineEmpty: 'This document has no rows or blocks yet.',
  outlineFilter: 'Filter',
  outlineHelp: 'Every section and block, as a list',
  outlineHide: 'Hide outline',
  outlineNoMatch: 'Nothing matches.',
  outlineShow: 'Show outline',
  pageMode: 'Page mode',
  pageModeHelp: 'The page up front, the admin’s header folded away',
  path: 'Path',
  previewHeight: 'Drag to change the preview’s height',
  remove: 'Remove',
  removed: (label) => `${label} removed`,
  replace: 'Replace',
  replaceHelp: 'Pick another file from the library',
  resizeSplit: 'Drag to resize form and preview, double-click to reset',
  selectParent: 'Select the block around it',
  tapHint: 'Tap anything on the page to edit it',
  undo: 'Undo',
  versions: 'Versions',
  viewport: 'Screen width',
  viewportDesktop: 'Desktop',
  viewportFit: 'Fit to panel',
  viewportMobile: 'Phone',
  viewportTablet: 'Tablet',
}

const de: EditorStrings = {
  addBelow: 'Darunter hinzufügen',
  allFields: 'Alle Felder',
  back: (list) => `Zurück zu ${list}`,
  closeForm: 'Formular schliessen',
  dock: 'Editor',
  duplicate: 'Duplizieren',
  duplicated: (label) => `${label} dupliziert`,
  editHere: 'Bearbeiten',
  focusMode: 'Fokus',
  focusModeHelp: 'Das Formular zeigt nur den gewählten Block',
  focusModeName: 'Fokus-Modus',
  focusModeOff: 'Fokus ist an: Nur der gewählte Block wird gezeigt. Klicken, um wieder alle Felder zu zeigen.',
  focusModeOn: 'Fokus: nur den gewählten Block zeigen',
  hint: 'Klick in der Vorschau springt zum Feld',
  hintModifier: (key) => ` – mit ${key} bedient man die Seite`,
  moved: (label) => `${label} verschoben`,
  moveDown: 'Nach unten',
  moveUp: 'Nach oben',
  notFound: 'Dieses Element hat kein Feld in diesem Formular (eine entfernte Zeile oder ein Feld, das nur im Seitenfenster bearbeitet wird)',
  notInForm: 'Nicht in diesem Formular',
  openForm: 'Formular öffnen',
  outline: 'Gliederung',
  outlineEmpty: 'Dieses Dokument hat noch keine Zeilen oder Blöcke.',
  outlineFilter: 'Filtern',
  outlineHelp: 'Alle Abschnitte und Blöcke als Liste',
  outlineHide: 'Gliederung ausblenden',
  outlineNoMatch: 'Nichts gefunden.',
  outlineShow: 'Gliederung zeigen',
  pageMode: 'Seiten-Modus',
  pageModeHelp: 'Die Seite im Vordergrund, der Kopf des Admins eingeklappt',
  path: 'Pfad',
  previewHeight: 'Ziehen, um die Höhe der Vorschau zu ändern',
  remove: 'Entfernen',
  removed: (label) => `${label} entfernt`,
  replace: 'Ersetzen',
  replaceHelp: 'Eine andere Datei aus der Mediathek wählen',
  resizeSplit: 'Ziehen, um Formular und Vorschau zu verteilen, Doppelklick setzt zurück',
  selectParent: 'Den umgebenden Block wählen',
  tapHint: 'Tippe auf etwas auf der Seite, um es zu bearbeiten',
  undo: 'Rückgängig',
  versions: 'Versionen',
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
