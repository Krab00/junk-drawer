// Plugin junkd's hooks module: the /junkd pane, the frame over the junk-drawer marketplace. The engine follows `$`
// only into functions of this file, never across an import, so every function that takes `$` lives here; the
// drawing is junkd-views.tsx, fed closures over `$`.
// - Plugins: every plugin of the marketplace, on or off at user scope (settings.json `enabledPlugins`); 1-9 flip one.
// - Settings: the `main` fields of each enabled plugin that exposes a noun on `$` (handoff, orch, tldr), read
//   through its schema()/get(), written through its set(); `settings ▸` calls its open().
// - Commands: the enabled plugins' slash commands as $.command.list() names them.
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
const isNoun = (name: string): name is Noun => (NOUNS as readonly string[]).includes(name)

let isOpen = false
let isChanged = false
let note = ''
let marketplace = MARKETPLACE
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
const loadMarketplace = async ($: $, cfg: string): Promise<Json> => {
  for (const dir of [`${$.plugin.root}/../..`, `${cfg}/plugins/marketplaces/${MARKETPLACE}`]) {
    const text = await $.fs.read(`${dir}/.claude-plugin/marketplace.json`).catch(() => undefined)
    if (text !== undefined) return JSON.parse(text) as Json
  }
  throw new Error(`${MARKETPLACE} marketplace.json not found`)
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
async function openOf($: $, noun: Noun): Promise<void> {
  if (noun === 'handoff') return $.handoff.open({ route: 'settings' })
  if (noun === 'orch') return $.orch.open()
  throw new Error(`${noun}: no pane`)
}

// ------------------------------------------------------------------ the pane's data

const refresh = async ($: $) => {
  try {
    const cfg = await configDir($)
    const data = await loadMarketplace($, cfg)
    const user = await readJson($, `${cfg}/settings.json`)
    const merged = (await $.settings.read()) as Json
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

const togglePane = async ($: $) => {
  if (isOpen) {
    isOpen = false
    await $.ui.close({ id: PANE })
    return
  }
  // `$.ui.open` before any await: only an open made while the press or command runs counts as asked.
  const opened = $.ui.open({ id: PANE, title: 'junkd', focus: true })
  isOpen = true
  note = ''
  void refresh($)
  await opened
}

// settings ▸: the plugin's own pane opens (its open(), the same path as its command), and this pane closes so the
// other one can take the keys.
const openSettings = async ($: $, plugin: string) => {
  if (!isNoun(plugin)) return
  try {
    await openOf($, plugin)
    isOpen = false
    await $.ui.close({ id: PANE })
  } catch (err) {
    note = `✗ ${reason(err)}`
    redraw($)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
    await $.command.register({ name: 'junkd', description: 'Toggle the junkd pane: the marketplace plugins, their settings and commands', immediate: true })
    if (isOpen) void refresh($)
    return next(e)
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
    return panelView($.ui.resolve(e) as Els, e.props, { marketplace, plugins, sections, commands, nouns: NOUNS, note, isChanged }, {
      close: () => void togglePane($),
      togglePlugin: name => void togglePlugin($, name),
      set: (plugin, key, value) => void setValue($, plugin, key, value),
      openPane: plugin => void openSettings($, plugin),
    })
  })
}
