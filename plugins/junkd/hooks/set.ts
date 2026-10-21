// The /junkd set as the five feature panes see it: whether it is up, and how to close all of it at once. panel.tsx
// opens it and draws junkd's pane. A feature pane that is still the set's (it opened through `show({ owner: SET_OWNER })`
// and nobody reopened or closed it since) answers its × and q, and the engine's close of its tab, with closeSet: one
// press ends the whole set, as the junkd pane's × does. A pane opened on its own has no mark and closes alone.
import type { $ } from './feature'
import { SET_OWNER } from './feature'
import { hidePane, type FeaturePane } from './dispatch'

export const PANE = 'junkd'
// The feature panes of the set, in tab order.
export const SET: readonly FeaturePane[] = ['handoff', 'orch', 'statusline', 'tools', 'lessons']

// A feature pane's mark says whether its close is the set's. Every way a pane stops being the set's (a close, an open
// of its own, settings ▸) clears the mark, so a marked pane is one the set opened and nobody has touched since.
export const isSets = (owner: string | undefined) => owner === SET_OWNER

const state = { isOpen: false }
export const setIsOpen = () => state.isOpen
export const setOpen = (isOpen: boolean) => {
  state.isOpen = isOpen
}

// The set's feature panes, each closed only while it is still the set's; `except` already went its own way.
export function hideSet($: $, except?: FeaturePane) {
  return SET.filter(p => p !== except).map(p => hidePane($, p, { owner: SET_OWNER }).catch(() => undefined))
}

// junkd and every feature pane still the set's, in one action. The set is down first, so a close that comes back to a
// hook does nothing more. A close that fails does not hold the others back (each is its own call).
export async function closeSet($: $): Promise<void> {
  state.isOpen = false
  await Promise.all([$.ui.close({ id: PANE }), ...hideSet($)])
}

// A pane's × while it is the set's: closeSet that never rejects (nobody awaits a press); the reason is a toast.
export async function shutSet($: $): Promise<void> {
  try {
    await closeSet($)
  } catch (err) {
    $.ui.toast(`✗ ${(err as Error)?.message ?? String(err)}`)
  }
}
