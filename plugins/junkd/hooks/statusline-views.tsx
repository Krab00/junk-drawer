// The statusline pane, `$`-free: the `statusline` group's rows (enabled, then one switch per segment) and a preview of
// the line the renderer draws for that choice, in the frame the orch pane draws (title row, rule, rows, note,
// footer). statusline.tsx hands it the elements, the values, the preview, the note and the actions.
import type { ElementTable, RenderInput } from 'claude-code'
import type { JunkdStatuslineField as Field, JunkdStatuslineSegment as Segment } from '../types'

export type Els = Pick<ElementTable<'terminal'>, 'Box' | 'Text' | 'Button'>
export type StatuslineActs = { close(): void; toggle(field: Field): void }
// `values.enabled` is whether settings.json's statusLine is junkd's; `config` is the pluginConfigs key the segment rows
// are stored under and the second-config warning ('' when there is none).
export type StatuslineData = { values: Record<Field, boolean>; preview: string; note: string; config: { key: string; warn: string } }

// Theme keys only, never a hex value: the colours follow the user's theme.
export const P = { accent: 'claude', secondary: 'inactive', dim: 'subtle', ok: 'success', bad: 'error' } as const
const EDGE = 2 // a docked pane's last column may not show
const LETTERS = 'abcdefghijklmnoprstuvwxyz' // q closes
// The segments in the order the line draws them.
export const SEGMENTS: readonly Segment[] = ['ctx', 'branch', 'worktree', 'model', 'effort', 'limits']
// The rows in hotkey order: enabled (a), then the segments (b-g).
export const FIELDS: readonly Field[] = ['enabled', ...SEGMENTS]
export const hotkeyOf = (field: Field): string => LETTERS[FIELDS.indexOf(field)]!
const LABELS: Record<Field, [string, string]> = {
  enabled: ['wired', 'statusLine in settings.json points at junkd/statusline.sh'],
  ctx: ['ctx', 'context free / used'],
  branch: ['branch', 'the git branch'],
  worktree: ['worktree', 'the linked worktree, only inside one'],
  model: ['model', "the model's name"],
  effort: ['effort', 'the effort level'],
  limits: ['limits', '5h / week rate-limit use'],
}

// The renderer's line as the pane draws it: its colours taken out (a Text draws an escape as text), and any other
// control character a space.
export const plain = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trimEnd()

export function statuslineView(els: Els, props: RenderInput<'Pane'>['props'], data: StatuslineData, act: StatuslineActs) {
  const { Box, Text, Button } = els
  const rule = (key: string) => (
    <Box key={key} height={1} overflow="hidden">
      <Text color={P.dim}>{'─'.repeat(400)}</Text>
    </Box>
  )
  const row = (field: Field) => {
    const isOn = data.values[field] === true
    const [label, hint] = LABELS[field]
    return (
      <Box key={`row:${field}`} flexDirection="row" height={1}>
        <Box width={2} flexShrink={0} />
        <Box width={10} flexShrink={0}>
          <Text>{label}</Text>
        </Box>
        <Box key={`${field}-pill`} width={5} flexShrink={0}>
          <Text inverse color={isOn ? P.ok : P.secondary}>
            {isOn ? ' on ' : ' off '}
          </Text>
        </Box>
        <Box width={6} flexShrink={0}>
          <Button key={`set:${field}`} plain dimColor hotkey={hotkeyOf(field)} label={isOn ? 'off' : 'on'} onPress={() => act.toggle(field)} />
        </Box>
        <Box flexShrink={1} overflow="hidden">
          <Text color={P.secondary} wrap="truncate-end">
            {hint}
          </Text>
        </Box>
      </Box>
    )
  }
  const sign = /^[✓✗]/.exec(data.note)?.[0]
  const note = (sign ? data.note.slice(1) : data.note).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
  return (
    <Box flexDirection="column" paddingRight={EDGE} minHeight={props.placement === 'dock' ? props.scroll?.bodyRows : undefined}>
      <Box flexDirection="row">
        <Box flexGrow={1}>
          <Text bold color={P.accent}>
            statusline
          </Text>
        </Box>
        <Button key="close" plain hotkey="q" label="×" dimColor onPress={act.close} />
      </Box>
      {rule('rule-top')}
      <Box flexDirection="column" flexGrow={1} marginTop={1}>
        <Text bold color={P.secondary}>
          Status line
        </Text>
        {row('enabled')}
        {data.config.key ? (
          <Box key="config-key" paddingLeft={2} height={1} overflow="hidden">
            <Text color={P.secondary} wrap="truncate-end">{`config: pluginConfigs ${data.config.key}`}</Text>
          </Box>
        ) : null}
        {data.config.warn ? (
          <Box key="config-warn" paddingLeft={2} height={1} overflow="hidden">
            <Text color={P.bad} wrap="truncate-end">{`✗ ${data.config.warn}`}</Text>
          </Box>
        ) : null}
        <Box marginTop={1}>
          <Text bold color={P.secondary}>
            Segments
          </Text>
        </Box>
        {SEGMENTS.map(row)}
        <Box marginTop={1} flexDirection="column">
          <Text bold color={P.secondary}>
            preview
          </Text>
          <Box key="preview" paddingLeft={2} height={1} overflow="hidden">
            <Text wrap="truncate-end">{data.preview || '(nothing to draw)'}</Text>
          </Box>
        </Box>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Box key="note" height={1} overflow="hidden">
          <Text color={P.secondary} wrap="truncate-end">
            {sign ? <Text color={sign === '✓' ? P.ok : P.bad}>{sign}</Text> : null}
            {note || 'also in /config, under junkd (statusline_…)'}
          </Text>
        </Box>
        {rule('rule-bottom')}
        <Text color={P.secondary} wrap="truncate-end">
          <Text bold>keys</Text> {`a-${hotkeyOf(FIELDS[FIELDS.length - 1]!)} switch  tab move  q close`}
        </Text>
      </Box>
    </Box>
  )
}
