// junkd's settings: a mirror of plugin.json's `userConfig` (a hooks module cannot import JSON; tests/smoke.sh holds
// every row to the manifest), and the spelling of a row's key. `$`-free.
//
// A row's key is `<group>_<field>` (the host takes only identifier keys in userConfig); its /config key is
// `junkd.<group>_<field>`; the register options carry it as `<group>_<field>`. Each group's `enabled` comes first.
import type { JunkdGroup, JunkdKey, JunkdSchemaEntry, JunkdValue } from '../types'

export const PLUGIN = 'junkd'
export const GROUPS: readonly JunkdGroup[] = ['core', 'handoff', 'orch', 'tldr']

export const SCHEMA: readonly JunkdSchemaEntry[] = [
  { key: 'core_output_style', group: 'core', field: 'output_style', type: 'string', title: 'Output style', default: 'ste', main: true, options: ['ste', 'off'] },
  { key: 'core_cache_check_sessions', group: 'core', field: 'cache_check_sessions', type: 'number', title: 'Cache check: sessions read', default: 10, main: true },
  { key: 'handoff_enabled', group: 'handoff', field: 'enabled', type: 'boolean', title: 'Auto handoff: enabled', default: true, main: true },
  { key: 'handoff_threshold', group: 'handoff', field: 'threshold', type: 'number', title: 'Auto handoff: context threshold (%)', default: 85, main: true },
  { key: 'handoff_checkEvery', group: 'handoff', field: 'checkEvery', type: 'number', title: 'Auto handoff: check every N tool calls', default: 5, main: false },
  { key: 'handoff_autoOn', group: 'handoff', field: 'autoOn', type: 'boolean', title: 'Auto handoff: armed at session start', default: false, main: true },
  { key: 'handoff_resumeAfterLimit', group: 'handoff', field: 'resumeAfterLimit', type: 'boolean', title: 'Auto handoff: resume after the 5h rate limit', default: true, main: true },
  { key: 'handoff_staleDays', group: 'handoff', field: 'staleDays', type: 'number', title: 'Handoffs: mark stale after N days', default: 30, main: false },
  { key: 'handoff_segment', group: 'handoff', field: 'segment', type: 'boolean', title: 'Status line: show the 🪃 segment', default: true, main: true },
  { key: 'orch_enabled', group: 'orch', field: 'enabled', type: 'boolean', title: 'Orchestrator: enabled', default: true, main: true },
  { key: 'orch_guard', group: 'orch', field: 'guard', type: 'string', title: 'Main-loop guard', default: 'fable', main: true, options: ['fable', 'always', 'off'] },
  { key: 'orch_allow_fable_agents', group: 'orch', field: 'allow_fable_agents', type: 'boolean', title: 'Allow Fable subagents', default: false, main: true },
  { key: 'orch_implementer_ctx_k', group: 'orch', field: 'implementer_ctx_k', type: 'number', title: 'Implementer context cap (k tokens)', default: 400, main: true },
  { key: 'orch_ui_review', group: 'orch', field: 'ui_review', type: 'boolean', title: 'UI review', default: true, main: false },
  { key: 'orch_inject_rules', group: 'orch', field: 'inject_rules', type: 'boolean', title: 'Inject orchestrator rules', default: true, main: false },
  { key: 'orch_rounds', group: 'orch', field: 'rounds', type: 'number', title: 'Fix rounds', default: 3, main: false },
  { key: 'orch_claude_md', group: 'orch', field: 'claude_md', type: 'boolean', title: 'CLAUDE.md pointer block', default: false, main: true },
  { key: 'tldr_enabled', group: 'tldr', field: 'enabled', type: 'boolean', title: 'TL;DR: enabled', default: true, main: true },
  { key: 'tldr_terse', group: 'tldr', field: 'terse', type: 'boolean', title: 'Terse mode', default: false, main: true },
  { key: 'tldr_sentences', group: 'tldr', field: 'sentences', type: 'number', title: 'Sentences in a summary', default: 3, main: true },
]

export const isKey = (key: unknown): key is JunkdKey => SCHEMA.some(f => f.key === key)
export const entryOf = (key: JunkdKey): JunkdSchemaEntry => SCHEMA.find(f => f.key === key)!
// A group's rows, in manifest order (`enabled` first).
export const rowsOf = (group: JunkdGroup): JunkdSchemaEntry[] => SCHEMA.filter(f => f.group === group)
// `handoff`, `threshold` -> `handoff_threshold`.
export const keyOf = (group: JunkdGroup, field: string): JunkdKey => `${group}_${field}` as JunkdKey
// The /config row of a key: `junkd.handoff_threshold`.
export const configKey = (key: JunkdKey): string => `${PLUGIN}.${key}`
// The filter a feature's config.set hook takes: every /config row of its group, `junkd.<group>_...`.
export const configKeys = (group: JunkdGroup): RegExp => new RegExp(`^${PLUGIN}\\.${group}_`)
// A /config key (`junkd.handoff_threshold`) to its group's field (`threshold`); undefined when it is no row of that group.
export function fieldOf(group: JunkdGroup, key: string): string | undefined {
  const prefix = `${PLUGIN}.${group}_`
  if (!key.startsWith(prefix)) return undefined
  const field = key.slice(prefix.length)
  return SCHEMA.some(f => f.group === group && f.field === field) ? field : undefined
}
// The register options (keyed by row) of one group, by field: `{ handoff_threshold: 70 }` -> `{ threshold: 70 }`.
export function groupOptions(options: Record<string, unknown>, group: JunkdGroup): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of rowsOf(group)) if (f.key in options) out[f.field] = options[f.key]
  return out
}
export type { JunkdGroup, JunkdKey, JunkdSchemaEntry, JunkdValue }
