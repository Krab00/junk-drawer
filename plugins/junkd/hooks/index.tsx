// Plugin junkd's hooks module: the /junkd pane, the frame over the junk-drawer marketplace. The engine follows `$`
// only into functions of this file, never across an import, so every function that takes `$` lives here; the
// drawing is junkd-views.tsx, fed closures over `$`.
// - The set: /junkd, ✚ junkd and q open and close junkd, handoff and orch together as tabs; each feature pane
//   through its noun's show/hide (another plugin's pane is its own to open), marked as the set's, so closing the
//   set leaves a feature pane opened on its own alone.
// - Plugins: every plugin of the marketplace, on or off at user scope (settings.json `enabledPlugins`); 1-9 flip one.
// - Settings: the `main` fields of each enabled plugin that exposes a noun on `$` (handoff, orch, tldr), read
//   through its schema()/get(), written through its set(); `settings ▸` calls its open().
// - Commands: the enabled plugins' slash commands as $.command.list() names them.
// - The `output_style` setting (ste|off): mirrored into the flag file scripts/setup.sh reads at SessionStart.
// The three nouns are called, never read (the host's rule), so an absent one is a call that throws: caught, and
// the pane opens without it. Paths follow CLAUDE_CONFIG_DIR like Claude Code itself; tests point it at a fake tree.
import type { EngineInterface, Register, RenderInput } from 'claude-code'
import { panelView, type Command, type Els, type Field, type PluginRow, type Section } from './junkd-views'

// One entry of a noun's schema(): the shape handoff, orch and tldr share (orch's choice row carries `options`).
type Entry = { key: string; type: string; title: string; default: unknown; main: boolean; options?: readonly string[] }

type $ = EngineInterface
type Json = Record<string, any>

const PANE = 'junkd'
const MARKETPLACE = 'junk-drawer'
// The plugins whose noun the Settings section reads, and whether open() exists on it (tldr has no pane).
const NOUNS = ['handoff', 'orch', 'tldr'] as const
type Noun = (typeof NOUNS)[number]
const HAS_PANE: Record<Noun, boolean> = { handoff: true, orch: true, tldr: false }
// The feature panes of the set, in tab order after junkd's.
const SET = NOUNS.filter(n => HAS_PANE[n])
const isNoun = (name: string): name is Noun => (NOUNS as readonly string[]).includes(name)

let isOpen = false
let isChanged = false
let note = ''
let marketplace = MARKETPLACE
let version = '' // the marketplace checkout's short sha; '' when it is no git checkout
let settingsShown = '~/.claude/settings.json' // the user-scope settings file as the Plugins title names it
let plugins: PluginRow[] = []
let sections: Section[] = []
let commands: Command[] = []
const redraw = ($: $) => $.ui.invalidate('ui.render')
// A refused noun call rejects with `junkd: $.<noun>.<method>: <reason>` (the host names the call); the note shows
// the reason. Any other error, its message.
const reason = (err: unknown) => ((err as Error)?.message ?? String(err)).replace(/^junkd: \$\.\w+\.\w+: /, '')

let home = ''
async function homeDir($: $): Promise<string> {
  if (home) return home
  home = (await $.env.get('HOME')) ?? ''
  if (!home) home = (await $.process.run(['sh', '-c', 'echo $HOME'])).stdout.trim()
  return home
}
const configDir = async ($: $) => (await $.env.get('CLAUDE_CONFIG_DIR')) || `${await homeDir($)}/.claude`
// User-scope settings: ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json, the file `enabledPlugins` lives in.
const settingsPath = async ($: $) => `${await configDir($)}/settings.json`
// A path under HOME spelled from ~, as the person reads it.
const tilde = (path: string, h: string) => (h && path.startsWith(`${h}/`) ? `~${path.slice(h.length)}` : path)

// ------------------------------------------------------------------ the output_style setting

// The setup step (scripts/setup.sh, SessionStart) is off while the flag file ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/junkd/
// output-style-off exists: a shell hook reads no `$.config`, so the row's truth is mirrored there, at every write
// to the row and at session start. `ste` (the default) or `off`, as the manifest's options; nothing else is taken.
let styleIsOff = false
const STYLE_ERROR = (raw: unknown) => `junkd: ${String(raw)} is not a valid output_style (ste or off)`
function coerceStyle(raw: unknown): { value: 'ste' | 'off'; error?: undefined } | { error: string; value?: undefined } {
  const v = String(raw).trim().toLowerCase()
  return v === 'ste' || v === 'off' ? { value: v } : { error: STYLE_ERROR(raw) }
}
async function writeStyleFlag($: $): Promise<void> {
  const flag = `${await configDir($)}/junkd/output-style-off`
  if (styleIsOff) await $.fs.write(flag, '')
  else await $.process.run(['rm', '-f', '--', flag])
}

// Missing file = {}. A file that does not parse throws, so a later write never replaces it with {}.
const readJson = async ($: $, path: string): Promise<Json> => ((await $.fs.exists(path)) ? JSON.parse(await $.fs.read(path)) : {})

// Temp + rename, so Claude Code never reads a half-written settings.json. Writes through a symlink.
const writeJson = async ($: $, path: string, data: Json) => {
  const real = (await $.fs.stat(path, { resolve: true }).catch(() => undefined))?.realPath ?? path
  const tmp = `${real}.junkd-tmp`
  await $.fs.write(tmp, `${JSON.stringify(data, null, 2)}\n`)
  const mv = await $.process.run(['/bin/mv', '-f', tmp, real])
  if (mv.exitCode !== 0) throw new Error(mv.stderr.trim() || `mv exited ${mv.exitCode}`)
}

// A checkout (--plugin-dir, or the repo itself) has the marketplace two levels up; an installed copy lives in the
// plugin cache under the config dir.
const loadMarketplace = async ($: $, cfg: string): Promise<{ dir: string; data: Json }> => {
  for (const dir of [`${$.plugin.root}/../..`, `${cfg}/plugins/marketplaces/${MARKETPLACE}`]) {
    const text = await $.fs.read(`${dir}/.claude-plugin/marketplace.json`).catch(() => undefined)
    if (text !== undefined) return { dir, data: JSON.parse(text) as Json }
  }
  throw new Error(`${MARKETPLACE} marketplace.json not found`)
}
// The header's sha: `git rev-parse --short HEAD` in the marketplace's folder; none where git fails or is missing.
const shortSha = async ($: $, dir: string): Promise<string> => {
  const git = await $.process.run(['git', '-C', dir, 'rev-parse', '--short', 'HEAD']).catch(() => undefined)
  return git?.exitCode === 0 ? git.stdout.trim() : ''
}

// ------------------------------------------------------------------ the nouns, spelled one by one

// The host lets a noun's method be called, never read: an absent noun is a call that throws, so each is tried.
async function schemaOf($: $, noun: Noun): Promise<readonly Entry[] | undefined> {
  try {
    if (noun === 'handoff') return await $.handoff.schema()
    if (noun === 'orch') return await $.orch.schema()
    return await $.tldr.schema()
  } catch {
    return undefined
  }
}
// The dependency's own key type is not known here (its contract is typed beside the API reference only once the
// engine lays it), so the key passes as the host sees it: one input, validated by the noun.
async function getOf($: $, noun: Noun, key: string): Promise<unknown> {
  if (noun === 'handoff') return $.handoff.get(key as never)
  if (noun === 'orch') return $.orch.get({ key: key as never })
  return $.tldr.get({ key: key as never })
}
async function setOf($: $, noun: Noun, key: string, value: unknown): Promise<unknown> {
  if (noun === 'handoff') return $.handoff.set({ key: key as never, value: value as never })
  if (noun === 'orch') return $.orch.set({ key: key as never, value: value as never })
  return $.tldr.set({ key: key as never, value: value as never })
}
// show opens a feature pane and never closes it: on its Settings tab for handoff when `settings`; `focus` asks for
// the keys; `owner` marks it as the set's. hide closes it; with `owner`, only while it is still the set's.
async function showOf($: $, noun: Noun, input: { focus?: true; owner?: string; settings?: true }): Promise<void> {
  const { settings, ...rest } = input
  if (noun === 'handoff') return $.handoff.show(settings ? { ...rest, route: 'settings' } : rest)
  if (noun === 'orch') return $.orch.show(rest)
  throw new Error(`${noun}: no pane`)
}
async function hideOf($: $, noun: Noun, owner?: string): Promise<void> {
  if (noun === 'handoff') return $.handoff.hide({ owner })
  if (noun === 'orch') return $.orch.hide({ owner })
  throw new Error(`${noun}: no pane`)
}

// ------------------------------------------------------------------ the pane's data

const refresh = async ($: $) => {
  try {
    const cfg = await configDir($)
    const { dir, data } = await loadMarketplace($, cfg)
    const user = await readJson($, `${cfg}/settings.json`)
    const merged = (await $.settings.read()) as Json
    settingsShown = tilde(`${cfg}/settings.json`, await homeDir($))
    version = await shortSha($, dir)
    marketplace = String(data.name ?? MARKETPLACE)
    plugins = ((data.plugins as Json[] | undefined) ?? []).map(entry => {
      const id = `${entry.name}@${marketplace}`
      const isSelf = entry.name === $.plugin.name
      return {
        name: String(entry.name),
        description: String(entry.description ?? ''),
        isSelf,
        isUserOn: user.enabledPlugins?.[id] === true,
        isActive: isSelf || merged.enabledPlugins?.[id] === true,
      }
    })
    const active = plugins.filter(p => p.isActive)
    sections = []
    for (const p of active) {
      if (!isNoun(p.name)) continue
      const schema = await schemaOf($, p.name)
      if (!schema) continue
      const fields: Field[] = []
      for (const f of schema.filter(f => f.main)) {
        const value = await getOf($, p.name, f.key).catch(() => f.default)
        fields.push({ key: f.key, type: f.type, title: f.title, ...(f.options ? { options: [...f.options] } : {}), value })
      }
      sections.push({ plugin: p.name, fields, hasPane: HAS_PANE[p.name] })
    }
    const listed = await $.command.list().catch(() => [])
    commands = listed
      .filter(c => c.source === 'plugin' && active.some(p => c.plugin === p.name || c.name.startsWith(`${p.name}:`)))
      .map(c => ({ name: c.name, description: c.description }))
  } catch (err) {
    note = `✗ ${err}`
  }
  redraw($)
}

const togglePlugin = async ($: $, name: string) => {
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

// A value typed or flipped in the pane goes to the plugin's set, which validates it; a refusal is the note.
const setValue = async ($: $, plugin: string, key: string, value: unknown) => {
  if (!isNoun(plugin)) return
  try {
    const stored = await setOf($, plugin, key, value)
    note = `✓ ${plugin}.${key} = ${JSON.stringify(stored)}`
  } catch (err) {
    note = `✗ ${reason(err)}`
  }
  await refresh($)
}

// /junkd, ✚ junkd and q: junkd (focused), handoff and orch as one set of tabs. Tabs go in open order (the engine has
// no position option), so junkd's `$.ui.open` comes before any await: only an open made while the press or command
// runs counts as asked. A feature pane already open on its own would keep its tab ahead of junkd's: each closes
// first (hide), then both open again in the set's order, marked as the set's (ponytail: they open after an await,
// so where the engine does not count them as asked, below 144 columns they wait undrawn until opened by hand).
// Closing the set closes junkd and each feature pane only while it is still the set's: one the person closed and
// opened again on its own stays. An absent noun (its plugin off) is a call that throws: the set goes without it.
const togglePane = async ($: $) => {
  if (isOpen) {
    isOpen = false
    await Promise.all([$.ui.close({ id: PANE }), ...SET.map(n => hideOf($, n, PANE).catch(() => undefined))])
    return
  }
  const opened = $.ui.open({ id: PANE, title: 'junkd', focus: true })
  isOpen = true
  note = ''
  void refresh($)
  await Promise.all(SET.map(n => hideOf($, n).catch(() => undefined)))
  await Promise.all([opened, ...SET.map(n => showOf($, n, { owner: PANE }).catch(() => undefined))])
}

// settings ▸: the press leaves junkd holding the keys, and the engine shows and focuses another pane only while no
// pane holds them (`focus` is a request, refused without a word). So the feature pane opens first (handoff on its
// Settings tab), junkd closes, and the feature pane asks for the keys again. It is the person's pane from then on.
// junkd is gone by the time a refusal comes back, so the reason is a toast.
const openSettings = async ($: $, plugin: string) => {
  if (!isNoun(plugin)) return
  note = '' // junkd's last answer is not the feature pane's
  const shown = showOf($, plugin, { settings: true })
  isOpen = false
  await $.ui.close({ id: PANE })
  try {
    await shown
    await showOf($, plugin, { settings: true, focus: true })
  } catch (err) {
    $.ui.toast(`✗ ${reason(err)}`)
  }
}

export const register: Register = (on, options) => {
  // A value the manifest's options do not name (an edit of the file by hand) is the default, ste.
  styleIsOff = coerceStyle(options.output_style).value === 'off'

  on('session.start', async ($, e, next) => {
    await writeStyleFlag($).catch(() => undefined)
    isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
    await $.command.register({ name: 'junkd', description: 'Toggle the junkd pane: the marketplace plugins, their settings and commands', immediate: true })
    if (isOpen) void refresh($)
    return next(e)
  })

  // Every write to the output_style row (the /config menu's; junkd has no noun of its own) lands here: a value the
  // options do not name is refused, one the row took is mirrored into the flag file.
  on('config.set', { key: 'junkd.output_style' }, async ($, e, next) => {
    const c = coerceStyle(e.value)
    if (c.error !== undefined) return { deny: c.error }
    const r = await next({ ...e, value: c.value })
    if (r.deny === undefined) {
      styleIsOff = c.value === 'off'
      await writeStyleFlag($)
    }
    return r
  })

  // /junkd (registered above) and /junkd:junkd (commands/junkd.md) both toggle the pane.
  on('command.run', { command: 'junkd' }, async $ => {
    await togglePane($)
    return {}
  })
  on('command.run', { command: 'junkd:junkd' }, async $ => {
    await togglePane($)
    return {}
  })

  // What is beneath (another plugin's hint, or the engine's own line), then ✚ junkd beside it.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const below = await next(e).catch(() => undefined)
    const toggle = (
      <Button key="junkd-toggle" plain label="junkd" onPress={() => void togglePane($)}>
        <Text color="claude">✚</Text> junkd
      </Button>
    )
    if (!below) return toggle
    return (
      <Box flexDirection="row" gap={2}>
        {below}
        {toggle}
      </Box>
    )
  })

  // The person's closes (q, ×) pass here; ours go through togglePane.
  on('ui.close', { id: PANE }, (_$, e, next) => {
    isOpen = false
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e: RenderInput<'Pane'>, next) => {
    // ponytail: mobile has no Input; it gets the engine's empty pane until it does.
    if (e.surface === 'mobile') return next(e)
    return panelView($.ui.resolve(e) as Els, e.props, { marketplace, version, settingsPath: settingsShown, plugins, sections, commands, nouns: NOUNS, note, isChanged }, {
      close: () => void togglePane($),
      togglePlugin: name => void togglePlugin($, name),
      set: (plugin, key, value) => void setValue($, plugin, key, value),
      openPane: plugin => void openSettings($, plugin),
    })
  })
}
