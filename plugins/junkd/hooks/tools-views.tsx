// The tools pane, `$`-free: four tabs (Agents, Tools, MCP, Skills) drawn from tools.ts's T in the frame the other junkd
// panes use (tabs, rule, body, note, keys). tools-pane.tsx hands it the elements, the pane's props and the actions.
// Own copies of the few parts the other panes draw alike. Every width comes from `props.bodyColumns`.
import type { ElementTable, RenderInput } from 'claude-code'
import {
  T, ROUTES, activeOf, ago, approxTokens, buildTree, flatten, fold, mcpRows, move, ofProject, select, selectedIn, skillRows, tokens, toolRows,
  type Node, type Route, type Status,
} from './tools'
import { verdictSuffix } from './watchdog.ts'

export type Els = Pick<ElementTable<'terminal'>, 'Box' | 'Text' | 'Button'>
export type ToolsActs = {
  close(): void
  go(route: Route): void
  refresh(): void
  reveal(): void
  redraw(): void
  focus(key: string): void
}
type Draw = { ui: Els }
type Hint = [key: string, label: string]
type Screen = { body: JSX.Element; note: JSX.Element | string; keys: Hint[] }
type View = (c: Draw, act: ToolsActs, cols: number, now: number) => Screen

// Theme keys only, never a hex value: the colours follow the user's theme.
export const P = { accent: 'claude', secondary: 'inactive', dim: 'subtle', ok: 'success', warn: 'warning', bg: 'userMessageBackground' } as const

const EDGE = 2 // a docked pane's last column may not show
const TABS: [key: string, label: string, route: Route][] = [['1', 'Agents', 'agents'], ['2', 'Tools', 'tools'], ['3', 'MCP', 'mcp'], ['4', 'Skills', 'skills']]
const GLYPH: Record<Status, [glyph: string, color: string]> = { running: ['●', P.ok], waiting: ['◐', P.warn], done: ['○', P.secondary] }
const KEYS_END: Hint[] = [['r', 'refresh'], ['t', 'transcript'], ['1-4', 'tab'], ['q', 'close']]

// Text the engine refuses (control characters) blanks the pane; a cell holds one line, cut to its width with `…`.
const clean = (text: string) => text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
export const fit = (text: string, n: number) => {
  const chars = [...clean(text)]
  if (n <= 0) return ''
  return chars.length > n ? `${chars.slice(0, n - 1).join('')}…` : chars.join('')
}
const pad = (text: string, n: number) => fit(text, n).padEnd(n)
const right = (text: string, n: number) => fit(text, n).padStart(n)

const Rule = ({ c }: { c: Draw }) => (
  <c.ui.Box height={1} overflow="hidden">
    <c.ui.Text color={P.dim}>{'─'.repeat(400)}</c.ui.Text>
  </c.ui.Box>
)
const Hidden = ({ c, k, hotkey, onPress }: { c: Draw; k: string; hotkey: string; onPress: () => void }) => (
  <c.ui.Box position="absolute" width={0} height={1} overflow="hidden">
    <c.ui.Button key={k} plain hotkey={hotkey} label="" onPress={onPress} />
  </c.ui.Box>
)
const Line = ({ c, k, text, color, bold }: { c: Draw; k: string; text: string; color?: string; bold?: boolean }) => (
  <c.ui.Box key={k} height={1} overflow="hidden">
    <c.ui.Text color={color} bold={bold || undefined}>{text}</c.ui.Text>
  </c.ui.Box>
)
const Empty = ({ c, text }: { c: Draw; text: string }) => <Line c={c} k="empty" text={`  ${text}`} color={P.secondary} />

// Agents tab ------------------------------------------------------------------------------------------------------

// One row: the tree guide, the fold mark (▾ open, ▸ folded, blank on a leaf), the status glyph of an agent, its name,
// then dim: an agent's type and model (and `done` once finished), a worktree's branch. Every row is a Button: the arrow
// keys move the focus ring along them (the ui.focus hook makes it the selection), Enter folds the focused one.
function agentRow(c: Draw, n: Node, guide: string, isOn: boolean, width: number, press: () => void) {
  const { Box, Text, Button } = c.ui
  const mark = n.children.length ? (T.folded[n.id] ? '▸ ' : '▾ ') : '  '
  const glyph = n.kind === 'agent' && n.status ? GLYPH[n.status] : undefined
  const parts = n.kind === 'agent' ? [n.type, n.model, n.status === 'done' ? 'done' : undefined] : [n.branch || undefined]
  if (n.kind === 'agent') parts.push(verdictSuffix(n.id.slice('agent:'.length)) || undefined) // the watchdog's verdict
  const extra = parts.filter(Boolean).join('  ')
  // Each part in turn takes what room is left, so a deep row in a narrow pane is cut, never wider than it.
  let room = width
  const take = (text: string) => {
    const part = fit(text, room)
    room -= [...part].length
    return part
  }
  const lead = take(guide)
  const fold = take(mark)
  const sign = glyph ? take(`${glyph[0]} `) : ''
  const name = take(n.label || '?')
  const rest = take(extra ? `  ${extra}` : '')
  return (
    <Box key={`row-${n.id}`} height={1} overflow="hidden" backgroundColor={isOn ? P.bg : undefined}>
      <Button key={`node:${n.id}`} plain label={clean(n.label || n.id)} onPress={press}>
        <Text>
          <Text color={P.dim}>{lead}</Text>
          <Text color={P.accent}>{fold}</Text>
          {glyph && sign ? <Text color={glyph[1]}>{sign}</Text> : null}
          <Text bold={n.kind !== 'agent' || undefined}>{name}</Text>
          <Text color={P.secondary}>{rest}</Text>
        </Text>
      </Button>
    </Box>
  )
}

const agents: View = (c, act, cols) => {
  const { Box, Text } = c.ui
  const legend = (s: Status) => <Text color={GLYPH[s][1]}>{GLYPH[s][0]}</Text>
  const note = (
    <Text color={P.secondary}>
      {legend('running')} running {legend('waiting')} waiting {legend('done')} done · agents of this session only
    </Text>
  )
  const keys: Hint[] = [['↑↓', 'select'], ['enter', 'fold'], ['a', T.showAll ? 'live only' : 'all'], ...KEYS_END]
  if (!T.loaded) return { body: <Empty c={c} text="reading…" />, note, keys }
  const mine = ofProject(T.agents, T.spawned, T.worktrees)
  const shown = activeOf(mine, T.showAll)
  // Live view: a worktree is a node only while a live agent sits in it (the root always is).
  const tree = buildTree(T.worktrees, shown, T.spawned, T.agentsOnly || !T.showAll)
  const stale = T.worktrees.length - 1 - tree.children.filter(n => n.kind === 'worktree').length
  const foot = [
    !T.showAll && stale > 0 ? `${stale} worktree${stale === 1 ? '' : 's'} without a live agent` : '',
    T.agents.length > mine.length ? `${T.agents.length - mine.length} other project${T.agents.length - mine.length === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' · ')
  const rows = flatten(tree, T.folded)
  const ids = rows.map(({ node }) => node.id)
  const sel = selectedIn(ids)
  const step = (by: number) => {
    const id = move(ids, by)
    if (id !== null) act.focus(`node:${id}`)
    act.redraw()
  }
  return {
    body: (
      <Box flexDirection="column">
        <Hidden c={c} k="down" hotkey="j" onPress={() => step(1)} />
        <Hidden c={c} k="up" hotkey="k" onPress={() => step(-1)} />
        <Hidden c={c} k="all" hotkey="a" onPress={() => { T.showAll = !T.showAll; act.redraw() }} />
        {rows.map(({ node, guide }, i) =>
          agentRow(c, node, guide, i === sel, cols, () => {
            select(node.id, ids)
            fold(node)
            act.redraw()
          }),
        )}
        {T.agents.length === 0 ? <Empty c={c} text="no agent spawned this session" /> : shown.length === 0 ? <Empty c={c} text={mine.length === 0 ? 'no agent of this project' : 'no live agent'} /> : null}
        {foot ? <Line c={c} k="foot" text={`  ${foot}`} color={P.dim} /> : null}
      </Box>
    ),
    note,
    keys,
  }
}

// Tools tab -------------------------------------------------------------------------------------------------------

// name | main | sub | ≈tokens, the numbers right-aligned in fixed cells; the name takes what is left. A table row is cut
// at the pane's width too: below about 40 columns the last cells go before the name does.
const NUM = 6
const TOK = 9
const tools: View = (c, act, cols) => {
  const { Box } = c.ui
  const rows = toolRows(T.counters.tools, T.mcp)
  const width = Math.max(4, cols - 2 - NUM * 2 - TOK)
  const calls = rows.reduce((n, r) => n + r.main + r.sub, 0)
  const line = (name: string, main: string, sub: string, tok: string) => fit(`  ${pad(name, width)}${right(main, NUM)}${right(sub, NUM)}${right(tok, TOK)}`, cols)
  return {
    body: (
      <Box flexDirection="column">
        <Line c={c} k="head" text={line('tool', 'main', 'sub', '≈tokens')} color={P.secondary} bold />
        <Rule c={c} />
        {rows.length === 0 ? <Empty c={c} text="no tool call yet" /> : null}
        {rows.map(r => (
          <Box key={`tool-${r.name}`} flexDirection="column">
            <Line c={c} k={`tool-row-${r.name}`} text={line(r.name, String(r.main), String(r.sub), approxTokens(r.chars))} />
            {r.servers ? <Line c={c} k="tool-mcp-hint" text={fit('    each server on the MCP tab (3)', cols)} color={P.dim} /> : null}
          </Box>
        ))}
      </Box>
    ),
    note: `${calls} calls · ${rows.length} rows · ≈tokens = result chars ÷ 4 · reset on /clear`,
    keys: [['3', 'MCP'], ...KEYS_END],
  }
}

// MCP tab ---------------------------------------------------------------------------------------------------------

const mcp: View = (c, _act, cols) => {
  const { Box } = c.ui
  const keys: Hint[] = KEYS_END
  const note = 'tools loaded/total and schema ≈tokens: the session usage summary · result ≈tokens = chars ÷ 4'
  if (!T.loaded) return { body: <Empty c={c} text="reading…" />, note, keys }
  const rows = mcpRows(T.counters.tools, T.mcp)
  const LOAD = 9
  const width = Math.max(4, cols - 2 - NUM - LOAD - TOK * 2)
  const line = (server: string, calls: string, load: string, schema: string, result: string) =>
    fit(`  ${pad(server, width)}${right(calls, NUM)}${right(load, LOAD)}${right(schema, TOK)}${right(result, TOK)}`, cols)
  return {
    body: (
      <Box flexDirection="column">
        <Line c={c} k="head" text={line('server', 'calls', 'tools', 'schema', 'result')} color={P.secondary} bold />
        <Rule c={c} />
        {rows.length === 0 ? <Empty c={c} text="no MCP server" /> : null}
        {rows.map(r => (
          <Line c={c} k={`mcp-${r.server}`} text={line(r.server, String(r.calls), `${r.loaded}/${r.all}`, r.all ? tokens(r.schemaTokens) : '-', approxTokens(r.chars))}
            color={r.calls ? undefined : P.secondary} />
        ))}
      </Box>
    ),
    note,
    keys,
  }
}

// Skills tab ------------------------------------------------------------------------------------------------------

const skills: View = (c, _act, cols, now) => {
  const { Box } = c.ui
  const rows = skillRows(T.counters)
  const VIA = 7
  const LAST = 10
  const width = Math.max(4, cols - 2 - VIA - NUM - LAST)
  const line = (name: string, via: string, count: string, last: string) => fit(`  ${pad(name, width)}${right(via, VIA)}${right(count, NUM)}${right(last, LAST)}`, cols)
  const runs = rows.reduce((n, [, r]) => n + r.count, 0)
  return {
    body: (
      <Box flexDirection="column">
        <Line c={c} k="head" text={line('skill', 'via', 'count', 'last')} color={P.secondary} bold />
        <Rule c={c} />
        {rows.length === 0 ? <Empty c={c} text="no skill run yet" /> : null}
        {rows.map(([name, r]) => <Line c={c} k={`skill-${name}`} text={line(name, r.via, String(r.count), ago(r.last, now))} />)}
      </Box>
    ),
    note: `${runs} runs · ${rows.length} skills · via slash: typed, via tool: the model's Skill call · reset on /clear`,
    keys: KEYS_END,
  }
}

const TAB_VIEW: Record<Route, View> = { agents, tools, mcp, skills }

// The tab row: the current tab inverse, the others dim Buttons on their digit; `q ×` at the right end.
function Tabs({ c, act }: { c: Draw; act: ToolsActs }) {
  const { Box, Text, Button } = c.ui
  return (
    <Box flexDirection="row" columnGap={2} flexWrap="wrap">
      {TABS.map(([key, label, route]) =>
        T.route === route ? (
          <Box key="tab-active" flexDirection="row">
            <Hidden c={c} k={`tab-${route}`} hotkey={key} onPress={() => act.go(route)} />
            <Text inverse bold color={P.accent}>{` ${key} ${label} `}</Text>
          </Box>
        ) : (
          <Box key={`tab-box-${route}`} flexDirection="row">
            <Button key={`tab-${route}`} plain hotkey={key} label={label} dimColor onPress={() => act.go(route)} />
          </Box>
        ),
      )}
      <Box flexGrow={1} />
      <Button key="close" plain hotkey="q" label="×" dimColor onPress={act.close} />
    </Box>
  )
}

function Footer({ c, note, keys }: { c: Draw; note: JSX.Element | string; keys: Hint[] }) {
  const { Box, Text } = c.ui
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box key="note" height={1} overflow="hidden">
        {typeof note === 'string' ? <Text color={P.secondary} wrap="truncate">{clean(note)}</Text> : note}
      </Box>
      <Rule c={c} />
      <Box key="keys" flexDirection="row" flexWrap="wrap" columnGap={2}>
        <Text bold color={P.secondary}>keys</Text>
        {keys.map(([k, label]) => (
          <Box key={`key-${k}`} flexDirection="row">
            <Text color={P.accent}>{k}</Text>
            <Text color={P.secondary}>{` ${label}`}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// `now` is the clock's time for the Skills tab's `last` column (the module reads it; a view reads no clock).
export function toolsView(els: Els, props: RenderInput<'Pane'>['props'], now: number, act: ToolsActs) {
  const c: Draw = { ui: els }
  const cols = Math.max(1, props.bodyColumns - EDGE) // never wider than the pane, however narrow
  const s = TAB_VIEW[ROUTES.includes(T.route) ? T.route : 'agents'](c, act, cols, now)
  return (
    <els.Box flexDirection="column" paddingRight={EDGE}>
      <Hidden c={c} k="refresh" hotkey="r" onPress={act.refresh} />
      <Hidden c={c} k="transcript" hotkey="t" onPress={act.reveal} />
      <Tabs c={c} act={act} />
      <Rule c={c} />
      <els.Box flexDirection="column" marginTop={1}>
        {s.body}
      </els.Box>
      <Footer c={c} note={s.note} keys={s.keys} />
    </els.Box>
  )
}
