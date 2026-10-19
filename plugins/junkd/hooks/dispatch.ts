// From a settings key or a pane name to the feature that owns it. The engine follows `$` into another file's
// function only when it is called by name, so each group is spelled out with its own `if` (see feature.ts).
import type { JunkdKey, JunkdValue } from '../types'
import { coreGet, coreSet } from './core'
import { ctxGet, ctxSet } from './ctx'
import type { $, HideInput, OpenInput, SetResult, ShowInput } from './feature'
import { handoffGet, handoffHide, handoffOpen, handoffSet, handoffShow } from './handoff'
import { orchGet, orchHide, orchOpen, orchSet, orchShow } from './orch'
import { SCHEMA, entryOf } from './settings'
import { statuslineGet, statuslineHide, statuslineOpen, statuslineSet, statuslineShow } from './statusline'
import { tldrGet, tldrSet } from './tldr'
import { toolsGet, toolsHide, toolsOpen, toolsSet, toolsShow } from './tools-pane'

export type FeaturePane = 'handoff' | 'orch' | 'statusline' | 'tools'

// One row's current value. The key is a row of SCHEMA (the caller checked).
export async function getSetting($: $, key: JunkdKey): Promise<JunkdValue> {
  const { group, field } = entryOf(key)
  if (group === 'core') return coreGet($, field)
  if (group === 'handoff') return handoffGet($, field)
  if (group === 'orch') return orchGet($, field)
  if (group === 'ctx') return ctxGet($, field)
  if (group === 'statusline') return statuslineGet($, field)
  if (group === 'tools') return toolsGet($, field)
  return tldrGet($, field)
}

// Validates, writes the row and applies it: the feature's own rules. The key is a row of SCHEMA (the caller checked).
export async function setSetting($: $, key: JunkdKey, raw: unknown): Promise<SetResult> {
  const { group, field } = entryOf(key)
  if (group === 'core') return coreSet($, field, raw)
  if (group === 'handoff') return handoffSet($, field, raw)
  if (group === 'orch') return orchSet($, field, raw)
  if (group === 'ctx') return ctxSet($, field, raw)
  if (group === 'statusline') return statuslineSet($, field, raw)
  if (group === 'tools') return toolsSet($, field, raw)
  return tldrSet($, field, raw)
}

// Every row's current value, by key, in manifest order.
export async function allSettings($: $): Promise<Record<JunkdKey, JunkdValue>> {
  const out = {} as Record<JunkdKey, JunkdValue>
  for (const f of SCHEMA) out[f.key] = await getSetting($, f.key)
  return out
}

export async function showPane($: $, pane: FeaturePane, input: ShowInput = {}): Promise<void> {
  if (pane === 'handoff') return handoffShow($, input)
  if (pane === 'statusline') return statuslineShow($, input)
  if (pane === 'tools') return toolsShow($, input)
  return orchShow($, input)
}
export async function hidePane($: $, pane: FeaturePane, input: HideInput = {}): Promise<void> {
  if (pane === 'handoff') return handoffHide($, input)
  if (pane === 'statusline') return statuslineHide($, input)
  if (pane === 'tools') return toolsHide($, input)
  return orchHide($, input)
}
export async function openPane($: $, pane: FeaturePane, input: OpenInput = {}): Promise<void> {
  if (pane === 'handoff') return handoffOpen($, input)
  if (pane === 'statusline') return statuslineOpen($, input)
  if (pane === 'tools') return toolsOpen($, input)
  return orchOpen($, input)
}
