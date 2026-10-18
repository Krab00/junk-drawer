// The /junkd pane's drawing, `$`-free: index.tsx hands it the surface's elements, the pane's data and its actions
// as closures (the engine follows `$` into no other file). Three sections: the marketplace's plugins (on/off at
// user scope), the main settings of every enabled plugin that exposes a noun on `$`, the enabled plugins' commands.
import type { ElementTable, RenderChildren, RenderInput } from 'claude-code'

export type PluginRow = { name: string; description: string; isSelf: boolean; isUserOn: boolean; isActive: boolean }
// One `main` entry of a plugin's schema(), with its current value (get) beside it.
export type Field = { key: string; type: string; title: string; options?: readonly string[]; value: unknown }
export type Section = { plugin: string; fields: Field[]; hasPane: boolean }
export type Command = { name: string; description: string }
export type PanelData = {
  marketplace: string
  version: string // the marketplace checkout's short sha, '' when none
  settingsPath: string // the user-scope settings file, ~ for HOME
  plugins: PluginRow[]
  sections: Section[]
  commands: Command[]
  nouns: readonly string[] // the plugins whose noun the pane reads, for the empty-settings note
  note: string
  isChanged: boolean
}
export type PanelActs = {
  close(): void
  togglePlugin(name: string): void
  set(plugin: string, key: string, value: unknown): void
  openPane(plugin: string): void
}
export type Els = Pick<ElementTable<'terminal'>, 'Box' | 'Text' | 'Button' | 'Input'>

const EDGE = 2 // a docked pane's last column may not show
// Theme keys only, never a hex value: the text follows the person's theme. The accent is junk-drawer's orange.
export const P = { accent: 'claude', secondary: 'inactive', dim: 'subtle', ok: 'success', warn: 'warning', bad: 'error' } as const
export const LETTERS = 'abcdefghijklmnoprstuvwxyz' // q closes
export const PLUGIN_KEYS = 9 // 1-9 flip a plugin; the tenth on has no hotkey

// The engine empties a field on Enter and redraws `value` only when it changed: a new key per Enter redraws it.
const entered: Record<string, number> = {}
export const fieldKey = (id: string) => (entered[id] ? `${id}~${entered[id]}` : id)

// A choice as Buttons, not the engine's Select: the current option an inverse block, every other a dim Button that
// picks it (the terminal Select opens on focus with the current option highlighted, so Enter picks it again).
const choices = (els: Els, id: string, options: readonly string[], current: unknown, pick: (value: string) => void) =>
  [...new Set(options.map(String))].map(o =>
    o === String(current) ? (
      <els.Box key={`${id}=${o}`} flexShrink={0}>
        <els.Text inverse>{` ${o} `}</els.Text>
      </els.Box>
    ) : (
      <els.Button key={`${id}=${o}`} plain dimColor label={o} onPress={() => pick(o)} />
    ),
  )

export function panelView(els: Els, props: RenderInput<'Pane'>['props'], data: PanelData, act: PanelActs) {
  const { Box, Text, Button, Input } = els
  const { plugins, sections, commands, note } = data
  const cols = Math.max(30, props.bodyColumns - EDGE)
  const nameWidth = Math.min(24, Math.floor(cols / 3))
  const toggles = plugins.filter(p => !p.isSelf)
  // Hotkeys follow the drawn order: the sections', then each section's fields'.
  const switches = sections.flatMap(s => s.fields.filter(f => f.type === 'boolean').map(f => `${s.plugin}:${f.key}`))

  const rule = (key: string) => (
    <Box key={key} height={1} overflow="hidden">
      <Text color={P.dim}>{'─'.repeat(400)}</Text>
    </Box>
  )
  // The title never gives up a column to its subtitle (a long settings path is cut instead).
  const title = (text: string, sub: string) => (
    <Box flexDirection="row" columnGap={1}>
      <Box key={`title:${text}`} flexShrink={0}>
        <Text bold color={P.accent}>
          {text}
        </Text>
      </Box>
      <Box flexShrink={1} overflow="hidden">
        <Text color={P.dim} wrap="truncate-end">
          {sub}
        </Text>
      </Box>
    </Box>
  )
  // One line: indent, a fixed name column, the middle cut to fit, the controls on the right.
  const row = (key: string, name: string, middle: RenderChildren, right?: RenderChildren, nameColor?: string) => (
    <Box key={key} flexDirection="row" height={1}>
      <Box width={2} flexShrink={0} />
      <Box width={nameWidth} flexShrink={0} overflow="hidden">
        <Text color={nameColor} wrap="truncate-end">
          {name}
        </Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} overflow="hidden">
        {middle}
      </Box>
      {right !== undefined && (
        <Box flexShrink={0} flexDirection="row" columnGap={1} marginLeft={2}>
          {right}
        </Box>
      )}
    </Box>
  )
  // The state as an inverse pill, then a dim Button for the other state.
  const switcher = (key: string, isOn: boolean, hotkey: string | undefined, flip: () => void) => [
    <Box key={`${key}-pill`} width={5}>
      <Text inverse color={isOn ? P.ok : P.secondary}>
        {isOn ? ' on ' : ' off '}
      </Text>
    </Box>,
    <Box key={`${key}-box`} width={hotkey ? 6 : 3}>
      <Button key={key} plain dimColor hotkey={hotkey} label={isOn ? 'off' : 'on'} onPress={flip} />
    </Box>,
  ]
  // A boolean flips through the plugin's set; a choice picks an option; a number or string is typed, Enter saves
  // it as typed: the plugin's `set` validates and refuses what does not fit (its reason lands in the note).
  const control = (plugin: string, f: Field) => {
    const id = `set:${plugin}:${f.key}`
    if (f.type === 'boolean') {
      return switcher(id, f.value === true, LETTERS[switches.indexOf(`${plugin}:${f.key}`)], () => act.set(plugin, f.key, f.value !== true))
    }
    if (f.options && f.options.length > 0) return choices(els, id, f.options, f.value, v => act.set(plugin, f.key, v))
    if (f.type === 'number' || f.type === 'string') {
      return (
        <Box width={Math.min(24, Math.floor(cols / 3))}>
          <Input
            key={fieldKey(id)}
            placeholder="enter saves"
            value={String(f.value ?? '')}
            onSubmit={value => {
              entered[id] = (entered[id] ?? 0) + 1
              act.set(plugin, f.key, value)
            }}
          />
        </Box>
      )
    }
    return <Text color={P.bad}>unsupported type {f.type}</Text>
  }
  const sign = /^[✓✗]/.exec(note)?.[0]
  const keys = [
    toggles.length > 0 ? `1-${Math.min(PLUGIN_KEYS, toggles.length)} plugin` : '',
    switches.length > 0 ? `a-${LETTERS[Math.min(switches.length, LETTERS.length) - 1]} setting` : '',
    'tab move',
    'q close',
  ].filter(Boolean)

  return (
    <Box flexDirection="column" paddingRight={EDGE} minHeight={props.placement === 'dock' ? props.scroll.bodyRows : undefined}>
      <Box flexDirection="row">
        <Box flexGrow={1} flexShrink={1} overflow="hidden">
          <Text wrap="truncate-end">
            <Text bold color={P.accent}>
              ✚ junkd
            </Text>
            {'  '}
            <Text color={P.secondary}>{`${data.marketplace} ${data.version}`.trim()}</Text>
          </Text>
        </Box>
        <Box flexShrink={0} marginLeft={2}>
          <Button key="close" plain hotkey="q" label="×" dimColor onPress={act.close} />
        </Box>
      </Box>
      {rule('rule-top')}

      <Box flexDirection="column" flexGrow={1} marginTop={1} gap={1}>
        <Box flexDirection="column">
          {title('Plugins', `user scope, ${data.settingsPath}`)}
          {plugins.map(p =>
            row(
              `plugin-row:${p.name}`,
              p.name,
              <Text color={P.secondary} wrap="truncate-end">
                {p.isActive && !p.isUserOn && !p.isSelf ? '(on in this project) ' : ''}
                {p.description}
              </Text>,
              p.isSelf
                ? [
                    <Box key="self" width={12}>
                      <Text color={P.dim}>this pane</Text>
                    </Box>,
                  ]
                : switcher(`plugin:${p.name}`, p.isUserOn, toggles.indexOf(p) < PLUGIN_KEYS ? String(toggles.indexOf(p) + 1) : undefined, () =>
                    act.togglePlugin(p.name),
                  ),
            ),
          )}
          {data.isChanged && row('reload', '', <Text color={P.warn}>run /reload-plugins to apply</Text>)}
        </Box>

        <Box flexDirection="column">
          {title('Settings', "each enabled plugin's main settings, through its $ noun")}
          {sections.length === 0 &&
            row('no-settings', '', <Text color={P.dim}>{`no settings: none of ${data.nouns.join(', ')} is loaded`}</Text>)}
          {sections.map(s => (
            <Box key={`group:${s.plugin}`} flexDirection="column" marginTop={1}>
              {rule(`rule:${s.plugin}`)}
              <Box flexDirection="row" height={1} paddingLeft={2}>
                <Box flexGrow={1}>
                  <Text bold color={P.accent}>
                    {s.plugin}
                  </Text>
                </Box>
                {s.hasPane && <Button key={`pane:${s.plugin}`} plain dimColor label="settings ▸" onPress={() => act.openPane(s.plugin)} />}
              </Box>
              {s.fields.map(f => row(`setting:${s.plugin}:${f.key}`, f.key, <Text wrap="truncate-end">{f.title}</Text>, control(s.plugin, f)))}
            </Box>
          ))}
        </Box>

        <Box flexDirection="column">
          {title('Commands', 'slash commands of the enabled plugins')}
          {commands.length === 0 && row('no-commands', '', <Text color={P.dim}>No commands.</Text>)}
          {commands.map(c =>
            row(
              `cmd:${c.name}`,
              `/${c.name}`,
              <Text color={P.dim} wrap="truncate-end">
                {c.description}
              </Text>,
              undefined,
              P.secondary,
            ),
          )}
        </Box>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Box key="note" height={1} overflow="hidden">
          <Text color={P.secondary} wrap="truncate-end">
            {sign ? <Text color={sign === '✓' ? P.ok : P.bad}>{sign}</Text> : null}
            {sign ? note.slice(1) : note}
          </Text>
        </Box>
        {rule('rule-bottom')}
        <Text color={P.secondary} wrap="truncate-end">
          <Text bold>keys</Text> {keys.join('  ')}
        </Text>
      </Box>
    </Box>
  )
}
