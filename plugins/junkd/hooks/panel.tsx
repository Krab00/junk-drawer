// The /junkd frame: /junkd, ✚ junkd and q open and close junkd, handoff, orch, statusline and tools together as tabs
// (tools only while tools_enabled is on); the junkd pane has the marketplace's plugins (on/off at user scope), every
// settings group of this plugin (core, handoff, orch, tldr, ctx, statusline, tools) and the commands. The drawing is
// junkd-views.tsx, fed closures over `$`.
// - Plugins: the marketplace's plugins, each on or off in the user's settings.json; junkd is this pane. handoff,
//   orch, tldr, ctx and statusline are no plugins of their own: each is switched by its group's `enabled` row.
// - The set: each feature pane through dispatch.ts's showPane/hidePane, marked as the set's (SET_OWNER), so closing
//   the set leaves a feature pane opened on its own alone.
// - Settings: the `main` rows of each group in settings.ts order (`enabled` first), read and written through
//   dispatch.ts; a refusal is the note. `settings ▸` opens the group's pane (handoff on its Settings tab, orch,
//   statusline, tools on its Agents tab).
// - Commands: the enabled plugins' slash commands (junkd's own /junkd:* among them) as $.command.list() names them.
import type { JunkdGroup } from '../types'
import type { On, RenderInput } from 'claude-code'
import { getSetting, hidePane, setSetting, showPane, type FeaturePane } from './dispatch'
import { SET_OWNER, type $ } from './feature'
import { panelView, type Command, type Els, type Field, type PluginRow, type Section } from './junkd-views'
import { GROUPS, isKey, keyOf, rowsOf } from './settings'
import { T as Tools } from './tools'

type Json = Record<string, any>

const PANE = 'junkd'
const MARKETPLACE = 'junk-drawer'
// The groups with a pane of their own, which `settings ▸` opens; the feature panes of the set, in tab order.
const SET: readonly FeaturePane[] = ['handoff', 'orch', 'statusline', 'tools']
const hasPane = (group: string): group is FeaturePane => (SET as readonly string[]).includes(group)
// The feature panes the set opens now: tools only while tools_enabled is on.
const opensNow = (): FeaturePane[] => SET.filter(p => p !== 'tools' || Tools.enabled)

let isOpen = false
let isChanged = false
let note = ''
let marketplace = MARKETPLACE
let version = '' // the marketplace checkout's short sha; '' when it is no git checkout
let settingsShown = '~/.claude/settings.json' // the user-scope settings file as the Plugins title names it
let plugins: PluginRow[] = []
let sections: Section[] = []
let commands: Command[] = []
function redraw($: $) {
  return $.ui.invalidate('ui.render')
}
const reason = (err: unknown) => (err as Error)?.message ?? String(err)

let home = ''
async function homeDir($: $): Promise<string> {
  if (home) return home
  home = (await $.env.get('HOME')) ?? ''
  if (!home) home = (await $.process.run(['sh', '-c', 'echo $HOME'])).stdout.trim()
  return home
}
async function configDir($: $) {
  return (await $.env.get('CLAUDE_CONFIG_DIR')) || `${await homeDir($)}/.claude`
}
// User-scope settings: ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json, the file `enabledPlugins` lives in.
async function settingsPath($: $) {
  return `${await configDir($)}/settings.json`
}
// A path under HOME spelled from ~, as the person reads it.
const tilde = (path: string, h: string) => (h && path.startsWith(`${h}/`) ? `~${path.slice(h.length)}` : path)

// Missing file = {}. A file that does not parse throws, so a later write never replaces it with {}.
async function readJson($: $, path: string): Promise<Json> {
  return ((await $.fs.exists(path)) ? JSON.parse(await $.fs.read(path)) : {})
}

// Temp + rename, so Claude Code never reads a half-written settings.json. Writes through a symlink.
async function writeJson($: $, path: string, data: Json) {
  const real = (await $.fs.stat(path, { resolve: true }).catch(() => undefined))?.realPath ?? path
  const tmp = `${real}.junkd-tmp`
  await $.fs.write(tmp, `${JSON.stringify(data, null, 2)}\n`)
  const mv = await $.process.run(['/bin/mv', '-f', tmp, real])
  if (mv.exitCode !== 0) throw new Error(mv.stderr.trim() || `mv exited ${mv.exitCode}`)
}

// A checkout (--plugin-dir, or the repo itself) has the marketplace two levels up; an installed copy lives in the
// plugin cache under the config dir.
async function loadMarketplace($: $, cfg: string): Promise<{ dir: string; data: Json }> {
  for (const dir of [`${$.plugin.root}/../..`, `${cfg}/plugins/marketplaces/${MARKETPLACE}`]) {
    const text = await $.fs.read(`${dir}/.claude-plugin/marketplace.json`).catch(() => undefined)
    if (text !== undefined) return { dir, data: JSON.parse(text) as Json }
  }
  throw new Error(`${MARKETPLACE} marketplace.json not found`)
}
// The header's sha: `git rev-parse --short HEAD` in the marketplace's folder; none where git fails or is missing.
async function shortSha($: $, dir: string): Promise<string> {
  const git = await $.process.run(['git', '-C', dir, 'rev-parse', '--short', 'HEAD']).catch(() => undefined)
  return git?.exitCode === 0 ? git.stdout.trim() : ''
}

// ------------------------------------------------------------------ the pane's data

// Each group's `main` rows in settings.ts order (`enabled` first), with the value its feature answers now; a read
// that fails draws the row's default. They are the module's own: no marketplace and no other plugin is needed.
async function readGroups($: $): Promise<Section[]> {
  const groups: Section[] = []
  for (const group of GROUPS) {
    const fields: Field[] = []
    for (const f of rowsOf(group).filter(f => f.main)) {
      const value = await getSetting($, f.key).catch(() => f.default)
      fields.push({ key: f.field, type: f.type, title: f.title, ...(f.options ? { options: [...f.options] } : {}), value })
    }
    groups.push({ group, fields, hasPane: hasPane(group) })
  }
  return groups
}

// Every press refreshes, so two refreshes can run side by side: each builds its rows apart and assigns them once at
// the end, and only the newest one started assigns at all (an older one, a step behind, is dropped). A marketplace
// or settings.json that cannot be read is the note; the Settings section is drawn all the same.
let refreshes = 0
async function refresh($: $) {
  const gen = ++refreshes
  let failed = ''
  let read: { shown: string; sha: string; name: string; rows: PluginRow[]; listed: Command[] } | undefined
  try {
    const cfg = await configDir($)
    const { dir, data } = await loadMarketplace($, cfg)
    const user = await readJson($, `${cfg}/settings.json`)
    const merged = (await $.settings.read()) as Json
    const shown = tilde(`${cfg}/settings.json`, await homeDir($))
    const sha = await shortSha($, dir)
    const name = String(data.name ?? MARKETPLACE)
    const rows: PluginRow[] = ((data.plugins as Json[] | undefined) ?? []).map(entry => {
      const id = `${entry.name}@${name}`
      const isSelf = entry.name === $.plugin.name
      return {
        name: String(entry.name),
        description: String(entry.description ?? ''),
        isSelf,
        isUserOn: user.enabledPlugins?.[id] === true,
        isActive: isSelf || merged.enabledPlugins?.[id] === true,
      }
    })
    const active = rows.filter(p => p.isActive)
    const listed = (await $.command.list().catch(() => []))
      .filter(c => c.source === 'plugin' && active.some(p => c.plugin === p.name || c.name.startsWith(`${p.name}:`)))
      .map(c => ({ name: c.name, description: c.description }))
    read = { shown, sha, name, rows, listed }
  } catch (err) {
    failed = `✗ ${err}`
  }
  const groups = await readGroups($)
  if (gen !== refreshes) return
  sections = groups
  if (read) {
    settingsShown = read.shown
    version = read.sha
    marketplace = read.name
    plugins = read.rows
    commands = read.listed
  } else note = failed
  redraw($)
}

// One flip after the other: each reads settings.json, changes one entry and writes it back through one temp name,
// so two flips at once would lose the first or move a temp file the other already moved.
let flips: Promise<void> = Promise.resolve()
function togglePlugin($: $, name: string): Promise<void> {
  const flip = flips.then(() => flipPlugin($, name))
  flips = flip.catch(() => undefined)
  return flip
}
async function flipPlugin($: $, name: string) {
  try {
    const path = await settingsPath($)
    const user = await readJson($, path)
    const id = `${name}@${marketplace}`
    const isOn = user.enabledPlugins?.[id] !== true
    user.enabledPlugins = { ...user.enabledPlugins, [id]: isOn }
    await writeJson($, path, user)
    isChanged = true
    note = `✓ ${name} ${isOn ? 'on' : 'off'}: run /reload-plugins`
  } catch (err) {
    note = `✗ ${err}`
  }
  await refresh($)
}

// A value typed or flipped in the pane goes to its group's set, which validates it; a refusal is the note.
async function setValue($: $, group: string, field: string, value: unknown) {
  const key = keyOf(group as JunkdGroup, field)
  if (!isKey(key)) return
  try {
    const r = await setSetting($, key, value)
    note = r.deny !== undefined ? `✗ ${r.deny}` : `✓ ${group}.${field} = ${JSON.stringify(r.value)}`
  } catch (err) {
    note = `✗ ${reason(err)}`
  }
  await refresh($)
}

// /junkd, ✚ junkd and q: junkd (focused), handoff, orch, statusline and tools as one set of tabs. Tabs go in open order (the
// engine has no position option), so junkd's `$.ui.open` comes before any await: only an open made while the press or command
// runs counts as asked. A feature pane already open on its own would keep its tab ahead of junkd's: each closes
// first, then both open again in the set's order, marked as the set's (ponytail: they open after an await, so where
// the engine does not count them as asked, below 144 columns they wait undrawn until opened by hand). Closing the
// set closes junkd and each feature pane only while it is still the set's: one the person closed and opened again
// on its own stays.
export async function panelToggle($: $): Promise<void> {
  if (isOpen) {
    isOpen = false
    await Promise.all([$.ui.close({ id: PANE }), ...SET.map(p => hidePane($, p, { owner: SET_OWNER }).catch(() => undefined))])
    return
  }
  const opened = $.ui.open({ id: PANE, title: 'junkd', focus: true })
  isOpen = true
  note = ''
  void refresh($)
  const panes = opensNow()
  await Promise.all(panes.map(p => hidePane($, p).catch(() => undefined)))
  await Promise.all([opened, ...panes.map(p => showPane($, p, { owner: SET_OWNER }).catch(() => undefined))])
}

// The set's other feature panes, closed with junkd when junkd goes some other way than a second toggle (the
// person's close, settings ▸); `hide({ owner })` closes only a pane still marked the set's.
function hideSet($: $, except?: FeaturePane) {
  return SET.filter(p => p !== except).map(p => hidePane($, p, { owner: SET_OWNER }).catch(() => undefined))
}

// settings ▸: the press leaves junkd holding the keys, and the engine shows and focuses another pane only while no
// pane holds them (`focus` is a request, refused without a word). So the feature pane opens first (handoff on its
// Settings tab), junkd closes with the set's other feature pane, and the feature pane asks for the keys again. It
// is the person's pane from then on. junkd is gone by the time a refusal comes back, so the reason is a toast.
async function openSettings($: $, group: string) {
  if (!hasPane(group)) return
  const route = group === 'handoff' ? ({ route: 'settings' } as const) : group === 'tools' ? ({ route: 'agents' } as const) : {}
  const shown = showPane($, group, route)
  isOpen = false
  await Promise.all([$.ui.close({ id: PANE }), ...hideSet($, group)])
  try {
    await shown
    await showPane($, group, { ...route, focus: true })
  } catch (err) {
    $.ui.toast(`✗ ${reason(err)}`)
  }
}

export async function panelStart($: $): Promise<void> {
  isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
  await $.command.register({ name: 'junkd', description: 'Toggle the junkd pane: the marketplace plugins, their settings and commands', immediate: true })
  if (isOpen) void refresh($)
}

// ✚ junkd, beside the rest of the prompt hint (index.tsx lays the line out).
export function panelButton($: $, e: RenderInput<'PromptHint'>) {
  const { Button, Text } = $.ui.resolve(e)
  return (
    <Button key="junkd-toggle" plain label="junkd" onPress={() => void panelToggle($)}>
      <Text color="claude">✚</Text> junkd
    </Button>
  )
}

export function registerPanel(on: On, _options: Record<string, unknown>): void {
  // /junkd (registered at session start) and /junkd:junkd (skills/junkd) both toggle the pane.
  on('command.run', { command: 'junkd' }, async $ => {
    await panelToggle($)
    return {}
  })
  on('command.run', { command: 'junkd:junkd' }, async $ => {
    await panelToggle($)
    return {}
  })

  // The person's closes (×, the tab's close; another plugin's $.ui.close) pass here: the set goes with junkd, each
  // feature pane only while it is still the set's. Our own closes (panelToggle, settings ▸) clear isOpen first and
  // close the set themselves, so one that comes back here does nothing more.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    const isPersons = isOpen
    isOpen = false
    const r = await next(e)
    if (isPersons) await Promise.all(hideSet($))
    return r
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e: RenderInput<'Pane'>, next) => {
    // ponytail: mobile has no Input; it gets the engine's empty pane until it does.
    if (e.surface === 'mobile') return next(e)
    return panelView($.ui.resolve(e) as Els, e.props, { marketplace, version, settingsPath: settingsShown, plugins, sections, commands, groups: GROUPS, note, isChanged }, {
      close: () => void panelToggle($),
      togglePlugin: name => void togglePlugin($, name),
      set: (group, field, value) => void setValue($, group, field, value),
      openPane: group => void openSettings($, group),
    })
  })
}
