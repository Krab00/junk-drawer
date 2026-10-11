// The panel's three tabs (Auto, Handoffs, Settings) as `View`s: each reads `S` and calls
// `c.api`, register.tsx draws the tabs, the rule and the footer around what they return.
import { S, type Entry, type Route } from './lib'
import { Chosen, Field, Filled, Hidden, P, Rule, Spacer, fit, line, when, type Ctx, type View } from './ui'

const DIR = '~/.claude/handoffs' // ponytail: the folder is fixed by the contract, drawn as is

// What a field holds while typed, before Enter saves it (`null` = show the stored value).
const draft: Record<string, string | null> = {}

const say = (c: Ctx, note: string) => { S.note = note; c.api.refresh() }
const hhmm = (ms: number) => when(new Date(ms).toISOString())
const k = (n: number) => `${Math.round(n / 1000)}k`
const byId = (id: string) => S.entries?.find((e) => e.id === id)

// A section title as the mock: bold secondary, an optional secondary subtitle.
const Title = ({ c, text, sub }: { c: Ctx; text: string; sub?: string }) => (
  <c.ui.Box flexDirection="row" columnGap={1}>
    <c.ui.Text bold color={P.secondary}>{text}</c.ui.Text>
    {sub ? <c.ui.Text color={P.secondary}>{sub}</c.ui.Text> : null}
  </c.ui.Box>
)

// A labelled row: 2 indent, the label in a `w`-wide column, the value.
const Row = ({ c, label, w = 14, children }: { c: Ctx; label?: string; w?: number; children: unknown }) => (
  <c.ui.Box flexDirection="row">
    <c.ui.Box width={2} flexShrink={0} />
    <c.ui.Box width={w} flexShrink={0}>{label ? <c.ui.Text>{label}</c.ui.Text> : null}</c.ui.Box>
    <c.ui.Box flexDirection="row" flexShrink={1} columnGap={2}>{children as never}</c.ui.Box>
  </c.ui.Box>
)

// Two choices as the mock: the current one drawn chosen, the other a dim Button on `hotkey`.
const Pick = ({ c, k, hotkey, now, other, flip }: { c: Ctx; k: string; hotkey: string; now: string; other: string; flip: () => void }) => (
  <c.ui.Box flexDirection="row" columnGap={1}>
    <Chosen c={c} text={now} />
    <c.ui.Button key={k} plain dimColor hotkey={hotkey} label={other} onPress={flip} />
  </c.ui.Box>
)
const Switch = ({ c, k, hotkey, on, flip }: { c: Ctx; k: string; hotkey: string; on: boolean; flip: () => void }) =>
  <Pick c={c} k={k} hotkey={hotkey} now={on ? 'on' : 'off'} other={on ? 'off' : 'on'} flip={flip} />

// ------------------------------------------------------------------ Auto

// The bar's colour as the segment's: ok, warn within 10 points of the threshold, bad over it.
const level = () => (S.percent >= S.threshold ? P.bad : S.percent >= S.threshold - 10 ? P.warn : P.ok)

const PHASE: Record<string, string> = { idle: 'idle, watching', handoff: 'writing the handoff…', clear: 'clearing…', resume: 'resuming…' }

const auto: View = (c) => {
  const { Box, Text, Button } = c.ui
  const width = Math.max(10, S.cols - 20) // ponytail: 2 indent + ` 100% / 85%` + the pane's edges
  const full = Math.min(width, Math.round((width * S.percent) / 100))
  const window = S.percent > 0 ? (S.tokens * 100) / S.percent : 0
  const at = (window * S.threshold) / 100
  const next = S.checkEvery - (S.calls % S.checkEvery)
  // what continuation() in register.tsx will actually send
  const cont = S.prompt ?? 'continue the handoff'
  const last = S.lastId ? byId(S.lastId) : undefined
  return {
    body: (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" columnGap={2}>
          <Text bold>Auto handoff</Text>
          {S.armed ? <Chosen c={c} text="armed" /> : <Text color={P.secondary}>off</Text>}
          <Text color={P.secondary} wrap="truncate">
            {line([S.armed && S.armedAt ? `since ${hhmm(S.armedAt)}` : '', `${S.count} handoff${S.count === 1 ? '' : 's'}`].filter(Boolean).join(' · '))}
          </Text>
          <Spacer c={c} />
          <Box flexShrink={0}>
            {S.armed
              ? <Button key="off" plain hotkey="o" label="Off" onPress={() => c.api.disarm()} />
              : <Button key="arm" plain hotkey="a" label="Arm" onPress={() => void c.api.arm()} />}
          </Box>
        </Box>
        <Box flexDirection="column">
          <Title c={c} text="Context" />
          <Box flexDirection="row" paddingLeft={2} height={1} overflow="hidden">
            <Text color={level()}>{'█'.repeat(full)}</Text>
            <Text color={P.dim}>{'█'.repeat(width - full)}</Text>
            <Text>{` ${S.percent}%`}</Text>
            <Text color={P.secondary}>{` / ${S.threshold}%`}</Text>
          </Box>
          <Box paddingLeft={2}>
            <Text color={P.secondary} wrap="truncate">
              {window ? `${k(S.tokens)} of ${k(window)} tokens · handoff at ${k(at)} · ${k(Math.max(0, at - S.tokens))} left` : 'no measure yet'}
            </Text>
          </Box>
          <Box paddingLeft={2}>
            <Text color={P.secondary}>{`checked every ${S.checkEvery} tool calls · next check in ${next}`}</Text>
          </Box>
        </Box>
        <Box flexDirection="column">
          <Title c={c} text="Loop" />
          <Row c={c} label="State">
            <Text><Text color={S.armed ? P.ok : P.secondary}>{S.armed ? '●' : '○'}</Text>{` ${S.phase === 'idle' && !S.armed ? 'idle, off' : PHASE[S.phase]}`}</Text>
          </Row>
          <Row c={c} label="Continue with"><Text wrap="truncate">{line(cont)}</Text></Row>
          <Box paddingLeft={16} flexDirection="column">
            <Field c={c} k="prompt-field" label="Set prompt" hotkey="p" hint="sent after each /handon · empty = just continue" placeholder="e.g. /orch:orch all"
              value={draft.prompt ?? S.prompt ?? ''} set={(v) => { draft.prompt = v }}
              onSubmit={(v) => { S.prompt = v.trim() || null; draft.prompt = null; say(c, S.prompt ? '✓ prompt set' : '✓ continues the handoff') }} />
          </Box>
          <Row c={c} label="Last handoff">
            <Text>{S.lastId ?? '—'}{last ? <Text color={P.secondary}>{` ${hhmm(last.mtimeMs)}`}</Text> : null}</Text>
          </Row>
          <Box flexDirection="row" columnGap={2} paddingLeft={2} marginTop={1}>
            <Filled c={c} k="now" hotkey="n" label="Handoff now" onPress={() => void c.api.handoffNow()} />
            {S.lastId ? <Button key="resume" plain hotkey="r" label="Resume last" onPress={() => void c.api.resume(S.lastId!)} /> : null}
          </Box>
        </Box>
        <Box flexDirection="column">
          <Title c={c} text="This session" />
          {S.session.length === 0 ? <Box paddingLeft={2}><Text color={P.secondary}>no handoffs yet</Text></Box> : null}
          {[...S.session].reverse().map((id) => {
            const e = byId(id)
            return (
              <Box key={`s-${id}`} flexDirection="row" paddingLeft={2} height={1} overflow="hidden">
                <Box width={7} flexShrink={0}><Text color={P.secondary}>{e ? hhmm(e.mtimeMs) : ''}</Text></Box>
                <Box width={10} flexShrink={0}><Text>{id}</Text></Box>
                <Text color={P.secondary} wrap="truncate">{line(e?.title ?? '')}</Text>
              </Box>
            )
          })}
        </Box>
      </Box>
    ),
    note: S.armed ? `✓ armed · threshold ${S.threshold}% · continues with ${S.prompt ? 'the set prompt' : 'the handoff'}` : 'off · a arms the loop',
    keys: [['tab', 'move'], [S.armed ? 'o' : 'a', S.armed ? 'off' : 'arm'], ['n', 'handoff now'], ['r', 'resume'], ['p', 'prompt'], ['l', 'use last']],
  }
}

// ------------------------------------------------------------------ Handoffs

const shown = (): Entry[] => {
  const f = S.filter.trim().toLowerCase()
  return (S.entries ?? []).filter((e) => !f || e.id.includes(f) || e.title.toLowerCase().includes(f) || new Date(e.mtimeMs).toISOString().includes(f))
}

// The selected row: the one the ring is on, else S.selected (clamped). A pending delete is
// dropped when the selection leaves its row.
function chosen(rows: Entry[]): Entry | undefined {
  const ringed = rows.findIndex((e) => S.ring === `row-${e.id}`)
  if (ringed >= 0) S.selected = ringed
  S.selected = Math.max(0, Math.min(S.selected, rows.length - 1))
  const e = rows[S.selected]
  if (S.confirm && S.confirm !== e?.id) S.confirm = null
  return e
}

const move = (c: Ctx, d: number) => { S.selected += d; S.confirm = null; c.api.refresh() }

function del(c: Ctx, id: string) {
  if (S.confirm !== id) { S.confirm = id; return say(c, `x again to delete ${id}`) }
  S.confirm = null
  void c.api.remove(id)
}

// Under the selected row, on its fill: enter Handon, v View, c Copy id, x Delete.
const Actions = ({ c, e }: { c: Ctx; e: Entry }) => (
  <c.ui.Box flexDirection="row" flexWrap="wrap" columnGap={3} paddingLeft={3}>
    <c.ui.Box flexDirection="row">
      <c.ui.Text color={P.accent}>enter: </c.ui.Text>
      <c.ui.Button key="handon" plain label="Handon" onPress={() => void c.api.handon(e.id)} />
    </c.ui.Box>
    <c.ui.Button key="view" plain hotkey="v" label="View" onPress={() => { S.viewing = e.id; c.api.refresh() }} />
    <c.ui.Button key="copy" plain hotkey="c" label="Copy id" onPress={() => void c.api.copy(e.id, c.surface)} />
    <c.ui.Button key="delete" plain hotkey="x" label={S.confirm === e.id ? 'Delete, sure?' : 'Delete'} onPress={() => del(c, e.id)} />
  </c.ui.Box>
)

// `v`: one handoff's facts; the full text opens with /handon (ponytail: no file text in S).
const viewing = (c: Ctx, e: Entry | undefined): ReturnType<View> => {
  const { Box, Text, Button } = c.ui
  const back = () => { S.viewing = null; c.api.refresh() }
  return {
    body: (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" columnGap={2} height={1} overflow="hidden">
          <Box flexShrink={0}><Button key="back" plain hotkey="b" label="Back" onPress={back} /></Box>
          <Text bold wrap="truncate">{line(e?.title || S.viewing || '')}</Text>
          <Spacer c={c} />
          <Box flexShrink={0}><Text color={P.secondary}>{S.viewing ?? ''}</Text></Box>
        </Box>
        {e ? (
          <Box flexDirection="column">
            <Row c={c} label="Path"><Text wrap="truncate">{line(e.path)}</Text></Row>
            <Row c={c} label="Saved"><Text>{new Date(e.mtimeMs).toLocaleString()}</Text></Row>
            <Row c={c} label="State"><Text color={e.stale ? P.warn : P.ok}>{e.stale ? 'stale' : 'ok'}</Text></Row>
            <Box paddingLeft={2} marginTop={1}><Actions c={c} e={e} /></Box>
          </Box>
        ) : <Text color={P.secondary}>this handoff is gone</Text>}
      </Box>
    ),
    note: S.confirm ? `x again to delete ${S.confirm}` : `full text: /handon ${S.viewing}`,
    keys: [['b', 'back'], ['enter', 'handon'], ['c', 'copy id'], ['x', 'delete']],
  }
}

const handoffs: View = (c) => {
  const { Box, Text, Button } = c.ui
  if (S.viewing) return viewing(c, byId(S.viewing))
  const all = S.entries
  const rows = shown()
  const page = rows.slice(0, 20 + S.more) // S.more starts at 0: the first page is 20
  const e = chosen(page)
  const col = (w: number, t: string, color?: string, bold?: boolean) =>
    <Box width={w} flexShrink={0}><Text color={color} bold={bold || undefined}>{t}</Text></Box>
  return {
    body: (
      <Box flexDirection="column" gap={1}>
        <Hidden c={c} k="down" hotkey="j" onPress={() => move(c, 1)} />
        <Hidden c={c} k="up" hotkey="k" onPress={() => move(c, -1)} />
        <Box flexDirection="row" columnGap={2}>
          <Text bold>Handoffs</Text>
          <Text color={P.secondary} wrap="truncate">{all ? `${all.length} in ${DIR} · ${S.session.length} this session` : 'loading…'}</Text>
          <Spacer c={c} />
          <Box flexShrink={0}><Button key="save" plain hotkey="n" label="Save now" onPress={() => void c.api.handoffNow()} /></Box>
        </Box>
        <Field c={c} k="filter" label="Filter" hotkey="f" labelDim placeholder="id, date or words of the title"
          value={S.filter} set={(v) => { S.filter = v; S.selected = 0; S.confirm = null; c.api.refresh() }} onSubmit={() => c.api.refresh()} />
        {!all ? <Text color={P.secondary}>loading…</Text>
          : all.length === 0 ? <Text color={P.secondary}>{`No handoffs in ${DIR} yet. n: Save now writes one.`}</Text>
          : rows.length === 0 ? <Text color={P.secondary}>{line(`No handoff matches "${S.filter.trim()}".`)}</Text>
          : (
            <Box flexDirection="column">
              <Box flexDirection="row" columnGap={1}>
                {col(2, '')}{col(10, 'When', P.secondary, true)}{col(10, 'Id', P.secondary, true)}
                <Box flexGrow={1} flexShrink={1}><Text bold color={P.secondary}>Title</Text></Box>
                {col(6, 'State', P.secondary, true)}
              </Box>
              <Rule c={c} />
              {page.map((x) => {
                const on = x === e
                return (
                  <Box key={`r-${x.id}`} flexDirection="column" backgroundColor={on ? P.bg : undefined}>
                    <Box flexDirection="row" columnGap={1} height={1} overflow="hidden">
                      {col(2, on ? '▸' : ' ', P.accent)}
                      {col(10, hhmm(x.mtimeMs), P.secondary)}
                      <Box width={10} flexShrink={0}>
                        <Button key={`row-${x.id}`} plain label={x.id} onPress={() => (on ? void c.api.handon(x.id) : (S.selected = page.indexOf(x), c.api.refresh()))} />
                      </Box>
                      <Box flexGrow={1} flexShrink={1}><Text wrap="truncate">{fit(x.title || '(untitled)', 200)}</Text></Box>
                      {col(6, x.stale ? 'stale' : 'ok', x.stale ? P.warn : P.ok)}
                    </Box>
                    {on ? <Actions c={c} e={x} /> : null}
                  </Box>
                )
              })}
              <Rule c={c} />
              <Box flexDirection="row" columnGap={1} paddingLeft={3}>
                {rows.length > page.length
                  ? <Button key="more" plain dimColor hotkey="m" label={`Show ${Math.min(20, rows.length - page.length)} more`} onPress={() => { S.more += 20; c.api.refresh() }} />
                  : null}
                <Text color={P.secondary}>· <Text color={P.warn}>stale</Text>{` = older than ${S.staleDays} days`}</Text>
              </Box>
            </Box>
          )}
      </Box>
    ),
    note: S.confirm ? `x again to delete ${S.confirm}` : 'enter on a row runs /handon <id> in this session',
    keys: [['tab', 'move'], ['j/k', 'select'], ['enter', 'handon'], ['v', 'view'], ['c', 'copy id'], ['x', 'delete'], ['f', 'filter'], ['m', 'more'], ['n', 'save now']],
  }
}

// ------------------------------------------------------------------ Settings

type NumField = 'threshold' | 'checkEvery' | 'staleDays'
const RANGE: Record<NumField, [number, number]> = { threshold: [1, 99], checkEvery: [1, 1000], staleDays: [1, 3650] }

// Enter in a number field: a whole number in range is saved, else the note says why.
function saveNum(c: Ctx, f: NumField, v: string) {
  const n = Number(v.trim())
  const [lo, hi] = RANGE[f]
  if (!Number.isInteger(n) || n < lo || n > hi) return say(c, `✗ ${f} takes a whole number ${lo}–${hi}`)
  draft[f] = null
  void c.api.set(f, n)
}

const Num = ({ c, f, hotkey, label, hint }: { c: Ctx; f: NumField; hotkey: string; label: string; hint: string }) => (
  <c.ui.Box paddingLeft={2} flexDirection="column">
    <Field c={c} k={f} label={label} hotkey={hotkey} hint={hint}
      value={draft[f] ?? String(S[f])} set={(v) => { draft[f] = v }} onSubmit={(v) => saveNum(c, f, v)} />
  </c.ui.Box>
)

const autoOn = () => S.autoOn

const settings: View = (c) => {
  const { Box, Text, Button } = c.ui
  const stale = (S.entries ?? []).filter((e) => e.stale).length
  return {
    body: (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Title c={c} text="Auto" sub="the loop: handoff → /clear → /handon → continue" />
          <Num c={c} f="threshold" hotkey="t" label="Threshold" hint="% of the context window" />
          <Num c={c} f="checkEvery" hotkey="e" label="Check every" hint="tool calls" />
          <Row c={c} w={22} label="Arm at session start">
            <Switch c={c} k="auto-on" hotkey="s" on={autoOn()} flip={() => void c.api.set('autoOn', !autoOn())} />
          </Row>
        </Box>
        <Box flexDirection="column">
          <Title c={c} text="Handoff" sub="/handoff and /handon" />
          <Row c={c} w={22} label="Folder">
            <Text wrap="truncate">{DIR}<Text color={P.secondary}>{S.entries ? ` · ${S.entries.length} files` : ''}</Text></Text>
          </Row>
          <Num c={c} f="staleDays" hotkey="a" label="Mark stale after" hint="days" />
          <Row c={c} w={22}>
            <Button key="delete-stale" plain hotkey="d" label={`Delete stale (${stale})`} onPress={() => void c.api.deleteStale()} />
            <Button key="open-folder" plain hotkey="o" label="Open folder" onPress={() => void c.api.openFolder()} />
          </Row>
        </Box>
        <Box flexDirection="column">
          <Title c={c} text="Status line" sub="the segment under the prompt" />
          <Row c={c} w={22} label="Segment">
            <Switch c={c} k="segment" hotkey="g" on={S.segment} flip={() => void c.api.set('segment', !S.segment)} />
          </Row>
          <Row c={c} w={22}><Text color={P.secondary}>{`🪃 ${S.percent}% · click opens or closes this panel`}</Text></Row>
        </Box>
        <Box flexDirection="column">
          <Title c={c} text="Version" />
          <Row c={c} w={22} label="handoff"><Text>{line(S.version || '?')}<Text color={P.secondary}> · settings also in /config</Text></Text></Row>
        </Box>
      </Box>
    ),
    note: 'enter in a field saves it',
    keys: [['tab', 'move'], ['enter', 'save field'], ['t', 'threshold'], ['e', 'every'], ['s', 'arm at start'], ['w', 'continue with'], ['a', 'stale days'], ['d', 'delete stale'], ['o', 'open folder'], ['g', 'segment']],
  }
}

export const VIEWS: Record<Route, View> = { auto, handoffs, settings }
