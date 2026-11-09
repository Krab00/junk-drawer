// The egm tab's drawing, `$`-free: three views of the model registry (list, form, JSON) drawn from egm.ts's E in the
// frame the other junkd panes use (header, rule, body, note, rule, keys). egm-pane.tsx hands it the elements, the
// pane's props, the state, the acts and the file as the labels name it. The labels are Polish by design.
//
// The add key is `n` and the cancel key `z`: a Button's `hotkey` takes one digit or one lowercase letter (the
// claude-code typings), so neither `+` nor `escape` can be one.
import type { ElementTable, RenderInput } from 'claude-code'
import { P, choices } from './junkd-views'
import { fit } from './tools-views'
import { CLASSES, CLASS_HINT, EFFORTS, HARNESSES, LEVELS, effortLabel, thinkingLabel, type E as State } from './egm'

export type Els = Pick<ElementTable<'terminal'>, 'Box' | 'Text' | 'Button' | 'Input'>
export type Field = 'class' | 'harness' | 'effort' | 'thinking' | 'pass'
export type EgmActs = {
  close(): void
  move(by: number): void
  select(index: number): void
  edit(): void
  remove(): void
  add(): void
  settings(): void
  setMode(m: 'form' | 'json'): void
  pick(field: Field, value: string): void
  cycle(field: Field): void
  setId(text: string): void
  setJson(text: string): void
  save(): void
  cancel(): void
  focus(key: string): void
}
// The file as the labels name it (~ for HOME), and the element that holds the focus ring.
export type EgmInfo = { path: string; focused?: string }
type S = typeof State

const EDGE = 2 // a docked pane's last column may not show
const ADD = 'n'
const CANCEL = 'z'
const LABEL = 17 // the form's label column, after a 2-column indent
// The list's columns after the 3-column indent: class, id, harness, effort; thinking takes the rest.
const W = { cls: 5, id: 34, harness: 14, effort: 8 }
const CLASS_LINE = 'D, E: rezerwa · klasy: A haiku · B sonnet · C opus · F frontier (kimi, fable)'
const SUFFIX = 'sufiks :level'
const PARAM = 'parametr'
const DASH = '—'
const pad = (text: string, n: number) => fit(text, n).padEnd(n)

export function egmView(els: Els, props: RenderInput<'Pane'>['props'], E: S, act: EgmActs, info: EgmInfo) {
  const { Box, Text, Button, Input } = els
  const cols = Math.max(30, props.bodyColumns - EDGE)

  const rule = (key: string) => (
    <Box key={key} height={1} overflow="hidden">
      <Text color={P.dim}>{'─'.repeat(400)}</Text>
    </Box>
  )
  const hidden = (key: string, hotkey: string, onPress: () => void) => (
    <Box key={`${key}-box`} position="absolute" width={0} height={1} overflow="hidden">
      <Button key={key} plain hotkey={hotkey} label="" onPress={onPress} />
    </Box>
  )
  const header = (list: boolean) => (
    <Box flexDirection="row">
      <Box flexGrow={1} flexShrink={1} overflow="hidden">
        <Text wrap="truncate-end">
          <Text bold color={P.accent}>
            egm
          </Text>
          <Text bold color={P.secondary}>
            {' · modele'}
          </Text>
          <Text color={P.secondary}>{` ${info.path}`}</Text>
        </Text>
      </Box>
      <Box flexShrink={0} flexDirection="row" columnGap={2} marginLeft={2}>
        {list && <Button key="egm-settings" plain hotkey="s" label="settings ▸" onPress={act.settings} />}
        {list && <Button key="egm-add" plain hotkey={ADD} label="Dodaj model" onPress={act.add} />}
        <Button key="egm-close" plain hotkey="q" label="×" dimColor onPress={act.close} />
      </Box>
    </Box>
  )
  const sign = (note: string) => /^[✓✗]/.exec(note)?.[0]
  const noteLine = (key: string, note: string) => {
    const s = sign(note)
    return (
      <Box key={key} height={1} overflow="hidden">
        <Text color={P.secondary} wrap="truncate-end">
          {s ? <Text color={s === '✓' ? P.ok : P.bad}>{s}</Text> : null}
          {s ? note.slice(1) : note}
        </Text>
      </Box>
    )
  }
  const keysLine = (keys: string[]) => (
    <Box key="keys" height={1} overflow="hidden">
      <Text color={P.secondary} wrap="truncate-end">
        <Text bold>keys</Text>
        {`  ${keys.join('  ')}`}
      </Text>
    </Box>
  )
  const frame = (list: boolean, body: JSX.Element, foot: JSX.Element[], keys: string[]) => (
    <Box key="egm-root" flexDirection="column" paddingRight={EDGE} minHeight={props.placement === 'dock' ? props.scroll.bodyRows : undefined}>
      {header(list)}
      {rule('rule-top')}
      <Box flexDirection="column" flexGrow={1}>
        {body}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {foot}
        {rule('rule-bottom')}
        {keysLine(keys)}
      </Box>
    </Box>
  )

  // list view -------------------------------------------------------------------------------------------------------
  if (E.view === 'list' || !E.form) {
    const thinkW = Math.max(1, cols - 3 - W.cls - W.id - W.harness - W.effort - 4)
    const cells = (cls: string, harness: string, effort: string, thinking: string) => ({
      cls: pad(cls, W.cls),
      harness: pad(harness, W.harness),
      effort: pad(effort, W.effort),
      thinking: fit(thinking, thinkW),
    })
    const head = cells('klasa', 'harness', 'effort', 'thinking')
    const body = (
      <Box flexDirection="column">
        {hidden('egm-down', 'j', () => act.move(1))}
        {hidden('egm-up', 'k', () => act.move(-1))}
        {hidden('egm-x', 'x', act.remove)}
        <Box key="egm-head" height={1} overflow="hidden">
          <Text bold color={P.secondary}>{`   ${head.cls} ${pad('id', W.id)} ${head.harness} ${head.effort} ${head.thinking}`}</Text>
        </Box>
        {rule('rule-head')}
        {E.fileError !== undefined ? (
          <Box key="egm-file-error" height={1} overflow="hidden">
            <Button key="egm-file-error-btn" plain dimColor label={`✗ ${E.fileError} · popraw plik ręcznie`} onPress={act.edit} />
          </Box>
        ) : E.list.length === 0 ? (
          <Box key="egm-empty" height={1} overflow="hidden">
            <Text dimColor>{`   brak modeli · ${ADD} dodaje pierwszy`}</Text>
          </Box>
        ) : (
          E.list.map((e, i) => {
            const on = i === E.sel
            const c = cells(e.class, e.harness, effortLabel(e), thinkingLabel(e))
            return (
              <Box key={`egm-row:${i}`} flexDirection="column" backgroundColor={on ? P.bg : undefined}>
                <Box flexDirection="row" height={1} overflow="hidden">
                  <Box width={3} flexShrink={0}>
                    <Text color={P.accent}>{on ? '▸ ' : '  '}</Text>
                  </Box>
                  <Box width={W.cls + 1} flexShrink={0}>
                    <Text bold color={P.accent}>
                      {c.cls}
                    </Text>
                  </Box>
                  <Box width={W.id + 1} flexShrink={0} overflow="hidden">
                    <Button key={`egm-row-btn:${i}`} plain label={fit(e.id, W.id)} onPress={() => (i === E.sel ? act.edit() : act.select(i))} />
                  </Box>
                  <Box width={W.harness + 1} flexShrink={0}>
                    <Text color={P.secondary}>{c.harness}</Text>
                  </Box>
                  <Box width={W.effort + 1} flexShrink={0}>
                    <Text>{c.effort}</Text>
                  </Box>
                  <Box flexGrow={1} flexShrink={1} overflow="hidden">
                    <Text wrap="truncate-end">{c.thinking}</Text>
                  </Box>
                </Box>
                {on && (
                  <Box key="egm-actions" height={1} overflow="hidden">
                    <Text color={P.secondary}>
                      {'   enter: Edytuj   '}
                      {E.pendX === i ? <Text color={P.bad}>x: Usuń (potwierdź)</Text> : 'x: Usuń'}
                    </Text>
                  </Box>
                )}
              </Box>
            )
          })
        )}
        {rule('rule-list')}
        <Box key="egm-classes" height={1} overflow="hidden">
          <Text dimColor wrap="truncate-end">{`   ${CLASS_LINE}`}</Text>
        </Box>
      </Box>
    )
    const effective = E.enabled && E.models
    const foot = [
      noteLine('note', E.note),
      <Box key="egm-footer" height={1} overflow="hidden">
        <Text color={P.secondary} wrap="truncate-end">
          {effective ? 'egm.models = true: pętla rozumienia bierze modele z tej listy' : 'egm.models = false: EGM pisze taski bez modeli z tej listy'}
        </Text>
      </Box>,
    ]
    return frame(true, body, foot, ['j/k select', 'enter edytuj', 'x usuń', `${ADD} dodaj`, 's settings', 'q close'])
  }

  // form and JSON views ---------------------------------------------------------------------------------------------
  const f = E.form
  const isJson = E.view === 'json'
  const title = f.editIndex === null ? 'Dodaj model' : 'Edytuj model'
  const label = (key: string, text: string, hotkey?: string, onPress?: () => void) => (
    <Box key={`${key}-label`} width={LABEL} flexShrink={0}>
      {hotkey && onPress ? <Button key={key} plain hotkey={hotkey} label={text} onPress={onPress} /> : <Text>{text}</Text>}
    </Box>
  )
  const line = (key: string, children: JSX.Element | (JSX.Element | false)[], marginTop = 0) => (
    <Box key={key} flexDirection="row" columnGap={1} paddingLeft={2} marginTop={marginTop || undefined}>
      {children}
    </Box>
  )
  const hint = (text: string) => (
    <Box flexShrink={1} overflow="hidden">
      <Text color={P.secondary} wrap="truncate-end">
        {text}
      </Text>
    </Box>
  )
  const opts = (id: string, options: readonly string[], current: string, onPick: (label: string) => void) => (
    <Box flexDirection="row" columnGap={1} flexShrink={0}>
      {choices(els, id, options, current, onPick)}
    </Box>
  )
  const box = (key: string, value: string, placeholder: string, onInput: (v: string) => void, onSubmit: (v: string) => void) => (
    <Box key={`${key}-border`} borderStyle="single" borderColor={info.focused === key ? P.accent : P.dim} paddingX={1} flexGrow={1}>
      <Input key={key} value={value} placeholder={placeholder} onInput={onInput} onSubmit={onSubmit} />
    </Box>
  )

  const top = (
    <Box key="egm-title" flexDirection="row" columnGap={2}>
      <Button key="egm-cancel" plain hotkey={CANCEL} label="Anuluj" onPress={act.cancel} />
      <Box flexGrow={1}>
        <Text bold>{title}</Text>
      </Box>
      <Text color={P.secondary}>{`→ ${info.path}`}</Text>
    </Box>
  )
  const mode = line(
    'egm-field:mode',
    [label('egm-mode', 'sposób'), opts('egm-choice:mode', ['formularz', 'wklej JSON'], isJson ? 'wklej JSON' : 'formularz', v => act.setMode(v === 'wklej JSON' ? 'json' : 'form'))],
    1,
  )
  const buttons = line(
    'egm-buttons',
    [
      <Box key="egm-save-box" flexShrink={0}>
        <Button key="egm-save" variant="primary" hotkey="s" label="Zapisz" onPress={act.save} />
      </Box>,
      <Box key="egm-cancel-2-box" flexShrink={0}>
        <Button key="egm-cancel-2" plain label={`${CANCEL}: Anuluj`} onPress={act.cancel} />
      </Box>,
    ],
    1,
  )

  let body: JSX.Element
  let defaultNote: string
  let keys: string[]
  if (isJson) {
    body = (
      <Box flexDirection="column" marginTop={1}>
        {top}
        {mode}
        <Box key="egm-json-head" flexDirection="row" columnGap={1} paddingLeft={2} marginTop={1}>
          <Text bold>JSON</Text>
          {hint('jeden obiekt · class, id, harness wymagane · effort, thinking {level, pass}')}
        </Box>
        <Box key="egm-json-row" flexDirection="row" paddingLeft={2}>
          {box('egm-field:json', f.json, 'wklej JSON', v => { f.json = v }, act.setJson)}
        </Box>
        <Box key="egm-json-legend" paddingLeft={2} height={1} overflow="hidden">
          <Text dimColor wrap="truncate-end">
            class: A B C F (D, E rezerwa) · harness: claude omp opencode codex kimi · pass: suffix | param
          </Text>
        </Box>
        {buttons}
      </Box>
    )
    defaultNote = 'klik albo tab w pole, wklej · esc wychodzi z pola · s parsuje JSON i dopisuje wiersz'
    keys = ['tab move', 'esc wyjdź z pola', 's zapisz', `${CANCEL} anuluj`, 'q close']
  } else {
    const e = f.entry
    const level = e.thinking.level
    const hasPass = level === 'on' || level === 'low' || level === 'medium' || level === 'high'
    const levelLabels = LEVELS.map(l => (l === '-' ? DASH : l))
    body = (
      <Box flexDirection="column" marginTop={1}>
        {top}
        {mode}
        {line('egm-field:class', [label('egm-key:a', 'klasa', 'a', () => act.cycle('class')), opts('egm-choice:class', CLASSES, e.class, v => act.pick('class', v)), hint(`${CLASS_HINT[e.class] ?? '?'}-class · D, E: rezerwa`)], 1)}
        <Box key="egm-field-row:id" flexDirection="column" paddingLeft={2}>
          <Box flexDirection="row" columnGap={1}>
            <Button key="egm-key:b" plain hotkey="b" label="id" onPress={() => act.focus('egm-field:id')} />
            {hint('id modelu w notacji tego harnessu')}
          </Box>
          <Box flexDirection="row">
            {box('egm-field:id', f.idText, 'wpisz id · enter zapisuje pole', v => { f.idText = v }, act.setId)}
          </Box>
        </Box>
        <Box key="egm-field:harness" flexDirection="column">
          {line('egm-harness-line', [label('egm-key:c', 'harness', 'c', () => act.cycle('harness')), opts('egm-choice:harness', HARNESSES, e.harness, v => act.pick('harness', v))])}
          <Box paddingLeft={2 + LABEL + 1} height={1} overflow="hidden">
            <Text color={P.secondary} wrap="truncate-end">
              tak junkd wywołuje inne harnessy · klucze i endpointy trzyma sam harness
            </Text>
          </Box>
        </Box>
        {line('egm-field:effort', [label('egm-key:d', 'effort', 'd', () => act.cycle('effort')), opts('egm-choice:effort', EFFORTS, e.effort, v => act.pick('effort', v)), hint('default: jak harness · none: brak')])}
        {line('egm-field:thinking', [
          label('egm-key:e', 'thinking', 'e', () => act.cycle('thinking')),
          opts('egm-choice:thinking', levelLabels, level === '-' ? DASH : level, v => act.pick('thinking', v === DASH ? '-' : v)),
          hint(`${DASH} = nie obsługuje`),
        ])}
        {hasPass &&
          line('egm-field:pass', [
            label('egm-key:f', 'jak przekazać', 'f', () => act.cycle('pass')),
            opts('egm-choice:pass', [SUFFIX, PARAM], e.thinking.pass === 'param' ? PARAM : SUFFIX, v => act.pick('pass', v === PARAM ? 'param' : 'suffix')),
            hint(e.thinking.pass === 'param' ? 'parametr w żądaniu' : '<id>:<level>'),
          ])}
        {buttons}
      </Box>
    )
    defaultNote = 'enter w polu zapisuje pole · s dopisuje model do models.json'
    keys = ['tab move', 'enter save field', 'a-f pole', '←→ wybór', 's zapisz', `${CANCEL} anuluj`, 'q close']
  }
  return frame(false, body, [noteLine('note', E.note || defaultNote)], keys)
}
