// The orch pane, `$`-free: the eight orch rows of plugin.json's userConfig on one Settings tab (a choice row, switches,
// number fields), in the frame the handoff pane draws (tabs, rule, title, rows, footer). orch.tsx hands it the
// elements, the current values, the note and the actions. Own copies of the few parts the handoff pane draws alike.
import type { ElementTable, RenderInput } from 'claude-code'
import type { JunkdOrchField as OrchField } from '../types'
import type { OrchSchemaEntry } from './orch-lib'
import { ORCH_RANGE, SCHEMA, type OrchValues } from './orch-lib'
import { DASH_RANGE, isDashField } from './orch-lib'
import { CLAMPED } from './orch-lib'

export type Els = Pick<ElementTable<'terminal'>, 'Box' | 'Text' | 'Button' | 'Input'>
export type OrchActs = { close(): void; set(key: OrchField, value: unknown): void; refuse(text: string): void; focus(key: string): void } & DashActs
// The `dashboard: open ▸` line: the same open path as /junkd:dashboard (dashboard.tsx). Left out, no line.
export type DashActs = { dashboard?(): void }
type Draw = { ui: Els }
type Hint = [key: string, label: string]

// Theme keys only, never a hex value: the colours follow the user's theme.
export const P = { accent: 'claude', secondary: 'inactive', dim: 'subtle', ok: 'success', bad: 'error' } as const

const EDGE = 2 // a docked pane's last column may not show
const LETTERS = 'abcdefghijklmnoprstuvwxyz' // q closes
export const TAB: [string, string, 'settings'][] = [['1', 'Settings', 'settings']]
// The manifest's `title` names the row; `description` is drawn beside it in these shorter words.
const HINTS: Record<OrchField, string> = {
  enabled: 'the guard and the rule sheet; off: neither',
  guard: 'hold the main loop to planning and delegating',
  allow_fable_agents: 'an explicit Fable model on a subagent',
  implementer_ctx_k: 'reuse an implementer under this many k tokens',
  ui_review: 'ui-reviewer on web UI criteria; off: PM-REVIEW rows',
  inject_rules: 'ORCHESTRATOR.md into the main session at start',
  rounds: 'fix rounds per task; --rounds overrides',
  claude_md: 'the CLAUDE.md orchestrator section as a pointer block; off removes it',
  dashboard_refresh: 'status.js again every N s while the dashboard is open',
  dashboard_window_h: 'the hours the dashboard timeline shows',
  watchdog: 'stalls, deaths and idle leftovers of this session\'s agents',
  idle_stop: 'stop a finished agent nobody needs; off: report it',
  idle_stop_minutes: 'idle minutes of a finished agent before a stop',
  stall_minutes: 'minutes without a tool call (reviewers +5)',
}

// The engine empties a field on Enter and only puts `value` back when it changed, so every Enter draws the field
// under its next key.
const entered: Record<string, number> = {}
export const fieldKey = (key: string) => (entered[key] ? `${key}~${entered[key]}` : key)
const rekey = (Input: Els['Input']): Els['Input'] => p =>
  Input({
    ...p,
    key: fieldKey(p.key),
    onSubmit: (v, e) => {
      entered[p.key] = (entered[p.key] ?? 0) + 1
      p.onSubmit(v, e)
    },
  })
// What a field holds while typed, before Enter saves it (`null` = show the stored value).
const draft: Record<string, string | null> = {}

const Rule = ({ c }: { c: Draw }) => (
  <c.ui.Box height={1} overflow="hidden">
    <c.ui.Text color={P.dim}>{'─'.repeat(400)}</c.ui.Text>
  </c.ui.Box>
)
const Spacer = ({ c }: { c: Draw }) => <c.ui.Box flexGrow={1} />
const Hidden = ({ c, k, hotkey, onPress }: { c: Draw; k: string; hotkey: string; onPress: () => void }) => (
  <c.ui.Box position="absolute" width={0} height={1} overflow="hidden">
    <c.ui.Button key={k} plain hotkey={hotkey} label="" onPress={onPress} />
  </c.ui.Box>
)
const Title = ({ c, text, sub }: { c: Draw; text: string; sub?: string }) => (
  <c.ui.Box flexDirection="row" columnGap={1}>
    <c.ui.Text bold color={P.secondary}>{text}</c.ui.Text>
    {sub ? <c.ui.Text color={P.secondary}>{sub}</c.ui.Text> : null}
  </c.ui.Box>
)
// A labelled row: 2 indent, the label in a `w`-wide column, the value.
const Row = ({ c, label, w = 14, children }: { c: Draw; label?: string; w?: number; children: unknown }) => (
  <c.ui.Box flexDirection="row">
    <c.ui.Box width={2} flexShrink={0} />
    <c.ui.Box width={w} flexShrink={0}>{label ? <c.ui.Text>{label}</c.ui.Text> : null}</c.ui.Box>
    <c.ui.Box flexDirection="row" flexShrink={1} columnGap={2}>{children as never}</c.ui.Box>
  </c.ui.Box>
)
// on/off: the current one drawn inverse, the other a dim Button on `hotkey`.
const Switch = ({ c, k, hotkey, on, flip }: { c: Draw; k: string; hotkey: string; on: boolean; flip: () => void }) => (
  <c.ui.Box flexDirection="row" columnGap={1}>
    <c.ui.Text inverse>{` ${on ? 'on' : 'off'} `}</c.ui.Text>
    <c.ui.Button key={k} plain dimColor hotkey={hotkey} label={on ? 'off' : 'on'} onPress={flip} />
  </c.ui.Box>
)
// A choice row: the current option inverse, the others dim Buttons.
const choices = (c: Draw, id: string, options: readonly string[], current: unknown, pick: (value: string) => void) =>
  options.map(o =>
    o === String(current) ? (
      <c.ui.Box key={`${id}=${o}`} flexShrink={0}>
        <c.ui.Text inverse>{` ${o} `}</c.ui.Text>
      </c.ui.Box>
    ) : (
      <c.ui.Button key={`${id}=${o}`} plain dimColor label={o} onPress={() => pick(o)} />
    ),
  )
// The tab row: the one tab inverse accent (its digit kept by a hidden Button), `q: ×` right.
const Tabs = ({ c, close }: { c: Draw; close: () => void }) => (
  <c.ui.Box flexDirection="row" columnGap={2} flexWrap="wrap">
    {TAB.map(([key, label, route]) => (
      <c.ui.Box key="tab-active" flexDirection="row">
        <Hidden c={c} k={`tab-${route}`} hotkey={key} onPress={() => {}} />
        <c.ui.Text inverse bold color={P.accent}>{` ${label} `}</c.ui.Text>
      </c.ui.Box>
    ))}
    <Spacer c={c} />
    <c.ui.Button key="close" plain hotkey="q" label="×" dimColor onPress={close} />
  </c.ui.Box>
)
// The note line (its `✓`/`✗` sign coloured), a rule, and the key hints.
const Footer = ({ c, note, hints }: { c: Draw; note: string; hints: Hint[] }) => {
  const sign = /^[✓✗]/.exec(note)?.[0]
  return (
    <c.ui.Box flexDirection="column" marginTop={1}>
      <c.ui.Box key="note" flexDirection="row" height={1} overflow="hidden">
        <c.ui.Text color={P.secondary} wrap="truncate">
          {sign ? <c.ui.Text color={sign === '✓' ? P.ok : P.bad}>{sign}</c.ui.Text> : null}
          {(sign ? note.slice(1) : note).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')}
        </c.ui.Text>
      </c.ui.Box>
      <Rule c={c} />
      <c.ui.Box key="hints" flexDirection="row" flexWrap="wrap" columnGap={2}>
        <c.ui.Text bold color={P.secondary}>keys</c.ui.Text>
        {hints.map(([k, label]) => (
          <c.ui.Box key={`hint-${k}`} flexDirection="row">
            <c.ui.Text>{k}</c.ui.Text>
            <c.ui.Text color={P.secondary}>{` ${label}`}</c.ui.Text>
          </c.ui.Box>
        ))}
      </c.ui.Box>
    </c.ui.Box>
  )
}
// A labelled one-line field: the label (a hotkey Button that focuses the field), then the Input in a border.
const Field = ({ c, k, label, hotkey, hint, value, onLabel, onSubmit }: { c: Draw; k: string; label: string; hotkey: string; hint: string; value: string; onLabel: () => void; onSubmit: (v: string) => void }) => (
  <c.ui.Box flexDirection="column">
    <c.ui.Box flexDirection="row" gap={1}>
      <c.ui.Button key={`${k}-focus`} plain hotkey={hotkey} label={label} onPress={onLabel} />
      <c.ui.Text color={P.secondary}>{hint}</c.ui.Text>
    </c.ui.Box>
    <c.ui.Box borderStyle="single" borderColor={P.dim} paddingX={1} flexGrow={1}>
      <c.ui.Input key={k} value={value} onInput={v => { draft[k] = v }} onSubmit={v => { draft[k] = null; onSubmit(v) }} />
    </c.ui.Box>
  </c.ui.Box>
)

// The rows with a letter hotkey: every row but the choice (its options are Buttons of their own).
export const keyed = (): OrchSchemaEntry[] => SCHEMA.filter(s => s.options === undefined)
export const hotkeyOf = (key: OrchField): string | undefined => {
  const i = keyed().findIndex(s => s.key === key)
  return i < 0 ? undefined : LETTERS[i]
}

export function orchView(els: Els, props: RenderInput<'Pane'>['props'], values: OrchValues, note: string, act: OrchActs) {
  const { Box, Text } = els
  const c: Draw = { ui: { ...els, Input: rekey(els.Input) } }
  const row = (s: OrchSchemaEntry) => {
    const id = `orch:${s.key}`
    const current = values[s.key]
    if (s.options !== undefined) {
      return (
        <Row c={c} w={30} label={s.title}>
          <Box flexDirection="row" columnGap={1}>{choices(c, id, s.options, current, v => act.set(s.key, v))}</Box>
          <Text color={P.secondary}>{HINTS[s.key]}</Text>
        </Row>
      )
    }
    const hotkey = hotkeyOf(s.key)!
    if (s.type === 'boolean') {
      return (
        <Row c={c} w={30} label={s.title}>
          <Switch c={c} k={id} hotkey={hotkey} on={current === true} flip={() => act.set(s.key, current !== true)} />
          <Text color={P.secondary}>{HINTS[s.key]}</Text>
        </Row>
      )
    }
    if (isDashField(s.key)) {
      const key = s.key
      const [dlo, dhi] = DASH_RANGE[key]
      return (
        <Box paddingLeft={2} flexDirection="column">
          <Field c={c} k={id} label={s.title} hotkey={hotkey} hint={`${HINTS[key]} · ${dlo}–${dhi}, clamped`} value={draft[id] ?? String(current)}
            onLabel={() => act.focus(fieldKey(id))}
            onSubmit={v => {
              const n = v.trim() === '' ? NaN : Number(v)
              if (Number.isFinite(n)) return act.set(key, n)
              act.refuse(`✗ ${key} takes a number ${dlo}–${dhi}, not "${v}"`)
            }} />
        </Box>
      )
    }
    const [lo, hi] = ORCH_RANGE[s.key as 'implementer_ctx_k' | 'rounds']
    return (
      <Box paddingLeft={2} flexDirection="column">
        <Field c={c} k={id} label={s.title} hotkey={hotkey} hint={`${HINTS[s.key]} · ${lo}–${hi}`} value={draft[id] ?? String(current)}
          onLabel={() => act.focus(fieldKey(id))}
          onSubmit={v => {
            const n = v.trim() === '' ? NaN : Number(v)
            if (CLAMPED.has(s.key) && Number.isFinite(n)) return act.set(s.key, n) // the watchdog's minutes: set clamps them
            if (Number.isInteger(n) && n >= lo && n <= hi) return act.set(s.key, n)
            act.refuse(`✗ ${s.key} takes a whole number ${lo}–${hi}, not "${v}"`)
          }} />
      </Box>
    )
  }
  const last = LETTERS[keyed().length - 1]!
  const keys: Hint[] = [['tab', 'move'], ['enter', 'save field'], [`a-${last}`, 'setting'], ['q', 'close']]
  return (
    <Box flexDirection="column" paddingRight={EDGE} minHeight={props.placement === 'dock' ? props.scroll?.bodyRows : undefined}>
      <Tabs c={c} close={act.close} />
      <Rule c={c} />
      <Box flexDirection="column" flexGrow={1} marginTop={1}>
        <Title c={c} text="Orchestrator" sub="the main-loop guard, agents and /junkd:orch" />
        {SCHEMA.map(row)}
        {act.dashboard ? (
          <Box key="orch:dashboard-line" flexDirection="row" paddingLeft={2} columnGap={1}>
            <Text>dashboard:</Text>
            <c.ui.Button key="orch:dashboard" plain label="open ▸" onPress={act.dashboard} />
            <Text color={P.secondary}>the task board and timeline in the browser · /junkd:dashboard</Text>
          </Box>
        ) : null}
      </Box>
      <Footer c={c} note={note || 'enter in a field saves it · also in /config, under junkd (orch_…)'} hints={keys} />
    </Box>
  )
}
