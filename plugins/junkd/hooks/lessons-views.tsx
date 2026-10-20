// The lessons tab, `$`-free: the pending lessons of the three stores, one row each (id · scope · stack · to · from ·
// text, cut to the pane), the dialog's top line, the confirm line of a check or role promote, the note and the keys.
// lessons.tsx hands it the elements, the pane's props and the actions. Every width comes from `props.bodyColumns`.
import type { ElementTable, RenderInput } from 'claude-code'
import { L, confirmText, meets, pendingOf, selectedLesson, topLine, type Lesson } from './lessons.ts'

export type Els = Pick<ElementTable<'terminal'>, 'Box' | 'Text' | 'Button'>
export type LessonsActs = {
  close(): void
  promote(): void // p: to its `to` (a check or a role asks in the confirm line first)
  drop(): void // d
  up(): void // u: one store up
  reload(): void // r
  yes(): void // y, while the confirm line is up
  no(): void // n, while the confirm line is up
  move(by: number): void // j/k (and the arrows through the rows' focus ring)
  select(ref: string): void
}
type Draw = { ui: Els }

// Theme keys only, never a hex value: the colours follow the user's theme.
export const P = { accent: 'claude', secondary: 'inactive', dim: 'subtle', warn: 'warning', bad: 'error', bg: 'userMessageBackground' } as const
const EDGE = 2 // a docked pane's last column may not show

// Text the engine refuses (control characters) blanks the pane; a cell holds one line, cut to its width with `…`.
const clean = (text: string) => text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
export const fit = (text: string, n: number) => {
  const chars = [...clean(text)]
  if (n <= 0) return ''
  return chars.length > n ? `${chars.slice(0, n - 1).join('')}…` : chars.join('')
}
const pad = (text: string, n: number) => fit(text, n).padEnd(n)

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
    <c.ui.Text color={color} bold={bold || undefined}>{fit(text, 400)}</c.ui.Text>
  </c.ui.Box>
)

// The cells' widths: id 5, scope 7, stack 12, to 13, from 6, the text what is left (at least 1). Below about 45
// columns the fixed cells are cut too: the row is never wider than the pane.
const W = { id: 5, scope: 7, stack: 12, to: 13, from: 6 }
export function rowText(l: Pick<Lesson, 'id' | 'scope' | 'stack' | 'to' | 'from' | 'text'>, cols: number): string {
  const fixed = W.id + W.scope + W.stack + W.to + W.from + 5
  const text = Math.max(1, cols - fixed)
  return fit(`${pad(l.id, W.id)} ${pad(l.scope, W.scope)} ${pad(l.stack.join(','), W.stack)} ${pad(l.to || '?', W.to)} ${pad(l.from, W.from)} ${fit(l.text, text)}`, cols)
}
const HEAD = { id: 'id', scope: 'scope', stack: ['stack'], to: 'to', from: 'from', text: 'text' }

export function lessonsView(els: Els, props: RenderInput<'Pane'>['props'], act: LessonsActs) {
  const c: Draw = { ui: els }
  const { Box, Text, Button } = els
  const cols = Math.max(1, props.bodyColumns - EDGE)
  const rows = pendingOf(L.lessons)
  const sel = selectedLesson(rows)
  const asking = L.confirm ? rows.find(l => l.ref === L.confirm) : undefined
  const keys: [string, string][] = asking
    ? [['y', 'yes'], ['n', 'no']]
    : [['j/k', 'select'], ['p', 'promote'], ['d', 'drop'], ['u', 'up a store'], ['r', 'reload'], ['q', 'close']]
  return (
    <Box flexDirection="column" paddingRight={EDGE}>
      <Hidden c={c} k="lessons:reload" hotkey="r" onPress={act.reload} />
      <Hidden c={c} k="lessons:down" hotkey="j" onPress={() => act.move(1)} />
      <Hidden c={c} k="lessons:up-sel" hotkey="k" onPress={() => act.move(-1)} />
      {asking ? <Hidden c={c} k="lessons:yes" hotkey="y" onPress={act.yes} /> : null}
      {asking ? <Hidden c={c} k="lessons:no" hotkey="n" onPress={act.no} /> : null}
      {!asking && sel ? <Hidden c={c} k="lessons:promote" hotkey="p" onPress={act.promote} /> : null}
      {!asking && sel ? <Hidden c={c} k="lessons:drop" hotkey="d" onPress={act.drop} /> : null}
      {!asking && sel && sel.scope !== 'global' ? <Hidden c={c} k="lessons:move-up" hotkey="u" onPress={act.up} /> : null}
      <Box flexDirection="row" columnGap={2}>
        <Text inverse bold color={P.accent}>{' lessons '}</Text>
        <Text color={P.secondary}>{fit(`pending of the three stores · this repo's stack: ${L.repoStacks.join(',')}`, Math.max(1, cols - 14))}</Text>
        <Box flexGrow={1} />
        <Button key="lessons:close" plain hotkey="q" label="×" dimColor onPress={act.close} />
      </Box>
      <Rule c={c} />
      {L.blocking && rows.length ? <Line c={c} k="lessons:top" text={topLine(rows.length)} color={P.warn} bold /> : null}
      <Box flexDirection="column" marginTop={1}>
        <Line c={c} k="lessons:head" text={rowText(HEAD, cols)} color={P.secondary} bold />
        {!L.loaded ? <Line c={c} k="lessons:reading" text="  reading…" color={P.secondary} /> : null}
        {L.loaded && rows.length === 0 ? <Line c={c} k="lessons:empty" text="  no pending lesson" color={P.secondary} /> : null}
        {L.loaded
          ? rows.map(l => (
              <Box key={`lessons:row-${l.ref}`} height={1} overflow="hidden" backgroundColor={sel?.ref === l.ref ? P.bg : undefined}>
                <Button key={`lesson:${l.ref}`} plain label={l.ref} onPress={() => act.select(l.ref)}>
                  <Text color={meets(l.stack, L.repoStacks) ? undefined : P.secondary}>{rowText(l, cols)}</Text>
                </Button>
              </Box>
            ))
          : null}
      </Box>
      {asking ? <Line c={c} k="lessons:confirm" text={`${confirmText(asking)} y/n`} color={P.warn} bold /> : null}
      <Box flexDirection="column" marginTop={1}>
        <Box key="lessons:note" height={1} overflow="hidden">
          <Text color={L.note.startsWith('✗') ? P.bad : P.secondary} wrap="truncate">{clean(L.note || (sel ? `${sel.ref}: ${sel.text}` : ''))}</Text>
        </Box>
        <Rule c={c} />
        <Box key="lessons:keys" flexDirection="row" flexWrap="wrap" columnGap={2}>
          <Text bold color={P.secondary}>keys</Text>
          {keys.map(([k, label]) => (
            <Box key={`lessons:key-${k}`} flexDirection="row">
              <Text color={P.accent}>{k}</Text>
              <Text color={P.secondary}>{` ${label}`}</Text>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  )
}
