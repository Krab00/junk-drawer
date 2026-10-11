import { expect, mock, test } from 'claude-code/testing'

const usage = (percent: number) => ({
  startedAt: 0, context: { window: 200000, tokens: percent * 2000, percent }, rateLimits: [],
})

test('arms, denies tools past the threshold, lets the handoff write through', { options: { threshold: 80, checkEvery: 1 } }, async ($, on) => {
  mock.store(on)
  let percent = 10
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: usage(percent) }))
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const run = await $.command.run({ command: 'ahandoff', args: 'do the thing', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(run.text).toContain('ahandoff on')

  const ok = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(ok.deny).toBeUndefined()

  percent = 90
  const denied = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(denied.deny).toContain('context limit')

  const write = await $.tool.call({ tool: 'Write', file_path: '/home/u/.claude/handoffs/2026-10-11T12-30_abcd1234.md', content: '# h' })
  expect(write.deny).toBeUndefined()

  const off = await $.command.run({ command: 'ahandoff', args: 'off', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(off.text).toBe('ahandoff off.')
  const free = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(free.deny).toBeUndefined()
})

test('turn.complete past the threshold asks /handoff, then chains clear → handon → continue', { options: { threshold: 80, checkEvery: 1 } }, async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  let percent = 90
  const commands: string[] = []
  const prompts: string[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: usage(percent) }))
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('command.run', (_$, e) => { commands.push(`${e.command} ${e.args}`.trim()); return { text: e.command } })
  on('prompt.submit', (_$, e) => { prompts.push(e.text); return { text: e.text } })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: '/orch:orch all', wait: false, origin: { kind: 'composer' } })
  await $.command.run({ command: 'ahandoff', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })

  // turn ends over the threshold with no handoff written → /handoff is queued
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(1)
  expect(commands).toEqual(['handoff'])

  // the /handoff turn writes the file and ends → clear → handon <id> → continuation prompt
  await $.tool.call({ tool: 'Write', file_path: '/home/u/.claude/handoffs/2026-10-11T12-30_abcd1234.md', content: '# h' })
  await $.turn.complete({ answer: 'saved', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  await clock.advance(1)
  expect(commands).toEqual(['handoff', 'clear', 'handon abcd1234'])
  expect(prompts.at(-1)).toContain('/orch:orch all')
})
