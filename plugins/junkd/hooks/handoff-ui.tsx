// The pane's drawing side, shared by every view (port of owl-post's ui.tsx, minimum needed).
import type { ElementTable } from 'claude-code'
import { S, type Field, type Route } from './handoff-lib'

// Theme keys only, never a hex value: the colours follow the user's theme.
export const P = {
  accent: 'claude', // hotkeys, the active tab
  secondary: 'inactive', // secondary text
  dim: 'subtle', // rules, field borders
  ok: 'success',
  warn: 'warning',
  bad: 'error',
  bg: 'userMessageBackground', // selected row
} as const

// A footer hint: key, what it does, and an optional colour for the key.
export type Hint = [key: string, label: string, color?: string]
export type Screen = { body: JSX.Element; note: string; keys: Hint[] }

export type Api = {
  go(route: Route): void
  arm(): Promise<void>
  disarm(): void
  handoffNow(): Promise<void>
  resume(id: string): Promise<void> // /clear → handon → continue-prompt (as the loop)
  handon(id: string): Promise<void> // only $.command.run junkd:handon <id>
  copy(id: string, surface: string): Promise<void>
  remove(id: string): Promise<void>
  deleteStale(): Promise<void>
  openFolder(): Promise<void>
  set(field: Field, value: string | number | boolean): Promise<void>
  refresh(): void
}

export type FieldProps = {
  k: string
  label?: string
  hotkey?: string
  onLabel?: () => void
  hint?: string
  placeholder?: string
  value: string
  set: (v: string) => void
  onSubmit: (v: string) => void
  submitLabel?: string
  main?: boolean
  labelDim?: boolean
}

// The elements every surface with a pane has (terminal, desktop, vscode), plus our Field.
export type Elements = Pick<ElementTable<'terminal'>, 'Box' | 'Text' | 'Button' | 'Input' | 'Select' | 'Link' | 'Code' | 'Markdown'>
export type UI = Elements & { Field: (p: FieldProps) => JSX.Element }
export type Ctx = { api: Api; ui: UI; surface: string }
export type View = (c: Ctx) => Screen

export const TABS: [key: string, label: string, route: Route][] = [
  ['1', 'Auto', 'auto'],
  ['2', 'Handoffs', 'handoffs'],
  ['3', 'Settings', 'settings'],
]

// The engine empties a field on Enter and only puts `value` back when it changed, so every Enter
// draws the field under its next key (owl-post's `fieldKey`).
const entered: Record<string, number> = {}
let focusField: (key: string) => void = () => {} // set by `fields` for the pane being drawn
export const fieldKey = (key: string) => (entered[key] ? `${key}~${entered[key]}` : key)

// Wraps the resolved elements: Input re-keyed per Enter, Field bound to this Ctx.
export function fields(els: Elements, api: Api, surface: string, focus: (key: string) => void): UI {
  focusField = focus
  const Input: Elements['Input'] = p =>
    els.Input({
      ...p,
      key: fieldKey(p.key),
      onSubmit: (v, e) => {
        entered[p.key] = (entered[p.key] ?? 0) + 1
        p.onSubmit(v, e)
        api.refresh()
      },
    })
  const ui: UI = { ...els, Input, Field: p => Field({ ...p, c }) }
  const c: Ctx = { api, ui, surface }
  return ui
}

// Text the engine refuses (control characters, > 10000 chars) blanks the pane: draw through clip/line.
export const DRAW_MAX = 4000
export const clean = (text: string) => text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, ' ')
export const clip = (text: string) =>
  text.length > DRAW_MAX ? `${clean(text.slice(0, DRAW_MAX))}\n… cut, ${text.length} characters in all` : clean(text)
export const line = (text: string) => clip(text.replace(/[\t\n]/g, ' ')).replace('\n', ' ')
export const fit = (text: string, n: number) => {
  const l = line(text)
  return [...l].length > n ? `${[...l].slice(0, Math.max(1, n - 1)).join('')}…` : l
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

// A row's time: `HH:MM` today, `yesterday`, the weekday within a week, else `4 Oct`.
export function when(ts: string | number, now = new Date()) {
  const d = new Date(ts)
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000)
  if (days <= 0) return hhmm(d)
  if (days === 1) return 'yesterday'
  if (days < 7) return DAYS[d.getDay()] ?? ''
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

// A run of `─` as wide as its box.
export const Rule = ({ c }: { c: Ctx }) => (
  <c.ui.Box height={1} overflow="hidden">
    <c.ui.Text color={P.dim}>{'─'.repeat(400)}</c.ui.Text>
  </c.ui.Box>
)

export const Spacer = ({ c }: { c: Ctx }) => <c.ui.Box flexGrow={1} />

// A hotkey with no visible control.
export const Hidden = ({ c, k, hotkey, onPress }: { c: Ctx; k: string; hotkey: string; onPress: () => void }) => (
  <c.ui.Box position="absolute" width={0} height={1} overflow="hidden">
    <c.ui.Button key={k} plain hotkey={hotkey} label="" onPress={onPress} />
  </c.ui.Box>
)

// The current choice as an inverse block (`[on]`); pressing it does nothing, so it is no Button.
export const Chosen = ({ c, text }: { c: Ctx; text: string }) => <c.ui.Text inverse>{` ${text} `}</c.ui.Text>

// A Button on the accent fill (ButtonProps has no colour, so the fill is a Box behind it).
export const Filled = ({ c, k, hotkey, label, onPress, rows = 1 }: { c: Ctx; k: string; hotkey?: string; label: string; onPress: () => void; rows?: number }) => (
  <c.ui.Box flexShrink={0} backgroundColor={P.accent} paddingX={hotkey ? 1 : 2} height={rows} flexDirection="column" justifyContent="center">
    <c.ui.Button key={k} plain hotkey={hotkey} label={label} onPress={onPress} />
  </c.ui.Box>
)

// The tab row: the current tab inverse accent (its digit kept by a hidden Button), the others dim, `q: ×` right.
export function Tabs({ c, close }: { c: Ctx; close: () => void }) {
  const { Box, Text, Button } = c.ui
  return (
    <Box flexDirection="row" columnGap={2} flexWrap="wrap">
      {TABS.map(([key, label, route]) =>
        S.route === route ? (
          <Box key="tab-active" flexDirection="row">
            <Hidden c={c} k={`tab-${route}`} hotkey={key} onPress={() => c.api.go(route)} />
            <Text inverse bold color={P.accent}>{` ${label} `}</Text>
          </Box>
        ) : (
          <Box key={`tab-box-${route}`} flexDirection="row">
            <Button key={`tab-${route}`} plain hotkey={key} label={label} dimColor onPress={() => c.api.go(route)} />
          </Box>
        ),
      )}
      <Spacer c={c} />
      <Button key="close" plain hotkey="q" label="×" dimColor onPress={close} />
    </Box>
  )
}

// The note line (its `✓`/`✗` sign coloured), a rule, and the key hints.
export function Footer({ c, note, hints }: { c: Ctx; note: string; hints: Hint[] }) {
  const { Box, Text } = c.ui
  const sign = /^[✓✗×]/.exec(note)?.[0]
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box key="note" flexDirection="row" height={1} overflow="hidden">
        <Text color={P.secondary} wrap="truncate">
          {sign ? <Text color={sign === '✓' ? P.ok : P.bad}>{sign}</Text> : null}
          {line(sign ? note.slice(1) : note)}
        </Text>
      </Box>
      <Rule c={c} />
      <Box key="hints" flexDirection="row" flexWrap="wrap" columnGap={2}>
        <Text bold color={P.secondary}>keys</Text>
        {hints.map(([k, label, color]) => (
          <Box key={`hint-${k}`} flexDirection="row">
            <Text color={color}>{k}</Text>
            {label ? <Text color={P.secondary}>{` ${label}`}</Text> : null}
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// A labelled one-line field: the label (a hotkey Button that focuses the field), then the Input in a border.
export function Field(p: FieldProps & { c: Ctx }) {
  const { Box, Text, Button, Input } = p.c.ui
  return (
    <Box flexDirection="column">
      {p.label ? (
        <Box flexDirection="row" gap={1}>
          {p.hotkey ? (
            <Button key={`${p.k}-focus`} plain hotkey={p.hotkey} label={p.label} dimColor={p.labelDim ? true : undefined}
              onPress={p.onLabel ?? (() => focusField(fieldKey(p.k)))} />
          ) : (
            <Text color={P.secondary}>{p.label}</Text>
          )}
          {p.hint ? <Text color={P.secondary}>{p.hint}</Text> : null}
        </Box>
      ) : null}
      <Box borderStyle="single" borderColor={p.main ? P.accent : P.dim} paddingX={1} flexGrow={1}>
        <Input key={p.k} placeholder={p.placeholder} value={p.value} submitLabel={p.submitLabel}
          onInput={v => p.set(v)}
          onSubmit={v => { p.set(v); p.onSubmit(v) }} />
      </Box>
    </Box>
  )
}
