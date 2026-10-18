// The orch mod: the main-loop guard (orch-lib's orchGuard and orchSpawn, pure) and its wiring in index.tsx (the live
// model, the SendMessage target from the agent list or the SubagentStop record, the placed path), the settings pane
// and `$.orch`. Everything beneath the plugin is answered from memory by `world`; nothing touches a real home.
import { expect, test } from 'claude-code/testing'
import type { Engine, Mounted, Plugin } from 'claude-code/testing'
import type { Args, On } from 'claude-code'
import { O, applyOrchSettings, coerce, orchGuard, orchSpawn, transcriptTokens, type OrchState, type OrchValues } from './orch-lib'

const CFG = '/fake/claude'
const FABLE = 'claude-fable-5-1'
const OPUS = 'claude-opus-5-5'
const BIN = '/p/bin/'
const on_: OrchValues = { guard: 'fable', allow_fable_agents: false, implementer_ctx_k: 400, ui_review: true, inject_rules: true, rounds: 3 }
const main = (tool: string, args: Record<string, unknown> = {}) => ({ tool, ...args })
const st = (s: Partial<OrchState> = {}): OrchState => ({ model: FABLE, binDir: BIN, configDir: CFG, ...s })
const SCRATCH = '/private/tmp/claude-501/-Users-u-repo/0b1c-session/scratchpad'
const PREFIX = 'Orchestrator mode (orch):'

// ------------------------------------------------------------------ orchGuard, pure

test('AC2: Edit, Grep, Glob, WebFetch and an MCP tool are each denied on a Fable main loop, the text starting with the prefix', () => {
  for (const tool of ['Edit', 'Grep', 'Glob', 'WebFetch', 'mcp__atlassian__getJiraIssue']) {
    const deny = orchGuard(main(tool), st(), on_)
    expect(deny, tool).toMatch(new RegExp(`^${PREFIX.replace(/[()]/g, '\\$&')} the main loop may not run ${tool}\\.`))
    expect(deny, tool).toMatch(/Delegate it to a subagent with the Agent tool .* then Read that path\./)
  }
  for (const tool of ['MultiEdit', 'NotebookEdit', 'WebSearch', 'LSP', 'TodoWrite']) expect(orchGuard(main(tool), st(), on_), tool).toContain(`may not run ${tool}`)
})

test('AC3: the coordination tools always pass', () => {
  for (const tool of ['ListAgents', 'TaskStop', 'AskUserQuestion', 'ToolSearch', 'Skill', 'CronList', 'CronDelete', 'EnterPlanMode', 'ExitPlanMode', 'PushNotification', 'RemoteTrigger']) {
    expect(orchGuard(main(tool), st(), on_), tool).toBeUndefined()
    expect(orchGuard(main(tool), st({ model: OPUS }), { ...on_, guard: 'always' }), tool).toBeUndefined()
  }
})

test('a subagent call always passes', () => {
  expect(orchGuard({ tool: 'Edit', agentId: 'a1' }, st(), on_)).toBeUndefined()
  expect(orchGuard({ tool: 'Bash', agentId: 'a1', command: 'git push' }, st(), { ...on_, guard: 'always' })).toBeUndefined()
})

test('guard fable | always | off', () => {
  expect(orchGuard(main('Edit'), st(), on_)).toBeDefined()
  expect(orchGuard(main('Edit'), st({ model: 'Fable' }), on_)).toBeDefined() // an alias or a display name counts
  expect(orchGuard(main('Edit'), st({ model: OPUS }), on_)).toBeUndefined()
  expect(orchGuard(main('Edit'), st({ model: OPUS }), { ...on_, guard: 'always' })).toBeDefined()
  expect(orchGuard(main('Edit'), st({ model: FABLE }), { ...on_, guard: 'always' })).toBeDefined()
  expect(orchGuard(main('Edit'), st(), { ...on_, guard: 'off' })).toBeUndefined()
  expect(orchGuard(main('Edit'), st({ model: OPUS }), { ...on_, guard: 'off' })).toBeUndefined()
})

test('Read: only the session scratchpad, the config dir\'s orch state, handoffs and project memory, no .. segment', () => {
  for (const p of [`${SCRATCH}/T-1-verify-coordinator.md`, `${CFG}/orch/-repo/tasks/T-1.md`, `${CFG}/handoffs/a.md`,
    `${CFG}/projects/-repo/memory/MEMORY.md`, '/tmp/claude-501/-repo/s1/scratchpad/r.md', `${SCRATCH}/./r.md`]) {
    expect(orchGuard(main('Read', { file_path: p }), st(), on_), p).toBeUndefined()
  }
  const outside = ['/repo/src/a.ts', '/repo/docs/handoffs/secret.ts', '/repo/x/orch/a.ts', '/tmp/scratchpad/a.md',
    `${SCRATCH}/../../../etc/passwd`, `${SCRATCH}/..`, `${CFG}/settings.json`, '/repo/claude-1/a/b/scratchpad/secret.ts',
    `${CFG}/projects/-repo/s1.jsonl`, `${CFG}/projects/-repo/x/memory/a.md`, `${CFG}/orch`, `${CFG}/orchestra/a.md`]
  for (const p of outside) expect(orchGuard(main('Read', { file_path: p }), st(), on_), p).toMatch(/may not run Read/)
})

test('Write: the Read roots or a new .md file; never settings, loaded config, a .claude dir, the plugin or a .. path', () => {
  const write = (file_path: string, exists: boolean) => orchGuard(main('Write', { file_path, content: 'x' }), st({ exists }), on_)
  expect(write(`${SCRATCH}/plan.md`, true)).toBeUndefined()
  expect(write(`${CFG}/orch/-repo/tasks/T-1.md`, true)).toBeUndefined()
  expect(write(`${CFG}/handoffs/2026-01-01T00-00_abcdef12.md`, false)).toBeUndefined()
  expect(write(`${CFG}/projects/-repo/memory/MEMORY.md`, true)).toBeUndefined() // the auto-memory index, kept whole
  expect(write('/repo/docs/design.md', false)).toBeUndefined() // a document the orchestrator composed
  // the default config dir spelled as the roots: its .claude segment is no bar
  const home = (file_path: string, exists: boolean) => orchGuard(main('Write', { file_path, content: 'x' }), st({ exists, configDir: '/home/u/.claude' }), on_)
  expect(home('/home/u/.claude/orch/-repo/tasks/T-1.md', true)).toBeUndefined()
  expect(home('/home/u/.claude/handoffs/x.md', false)).toBeUndefined()
  expect(home('/home/u/.claude/notes.md', false)).toMatch(/may Write only/)
  for (const [p, exists] of [['/repo/docs/design.md', true], ['/repo/src/a.ts', false],
    ['/home/u/.claude/settings.local.json', true], ['/home/u/.claude/plugins/cache/x/skills/a/SKILL.md', false],
    [`${SCRATCH}/../../x.md`, false],
    // loaded config, in any .claude dir, the config dir or by its name
    ['/home/u/.claude/skills/pwn/SKILL.md', false], ['/home/u/.claude/agents/pwn.md', false], ['/home/u/.claude/rules/pwn.md', false],
    ['/repo/.claude/commands/pwn.md', false], ['/repo/.claude/output-styles/pwn.md', false], ['/repo/.Claude/Hooks/pwn.md', false],
    ['/repo/.claude/notes.md', false], ['/repo/.claude/settings.json', true],
    [`${CFG}/skills/pwn/SKILL.md`, false], [`${CFG}/anything/new.md`, false], [`${CFG}/projects/-repo/notes.md`, false],
    [`${CFG}/CLAUDE.md`, true], ['/repo/src/CLAUDE.md', false], ['/repo/CLAUDE.local.md', false], ['/repo/AGENTS.md', false],
    ['/repo/docs/claude.md', false], ['/repo/x/SKILL.md', false],
    // this plugin (bin/'s parent), however the path is spelled
    ['/p/agents/pwn.md', false], ['/p/skills/x/notes.md', false], ['/p//agents/./pwn.md', false],
    // any other plugin's loaded dirs under a plugins/ path, and a .claude-plugin/ manifest dir
    ['/kit/plugins/other/agents/pwn.md', false], ['/kit/plugins/other/commands/pwn.md', false],
    ['/dev/plugins/x/skills/a/notes.md', false], ['/dev/Plugins/x/Hooks/n.md', false], ['/kit/plugins/o/rules/r.md', false],
    ['/kit/plugins/o/output-styles/s.md', false], ['/repo/.claude-plugin/notes.md', false]] as const) {
    expect(write(p, exists), p).toMatch(/may Write only to .* ask the user for a target path or delegate/)
  }
  expect(write('/kit/plugins/other/docs/notes.md', false)).toBeUndefined() // not a loaded dir
  // this plugin's marketplace (<market>/plugins/<name>/bin/): a loaded dir anywhere in it, a plugin may sit at its root
  const kit = (file_path: string) => orchGuard(main('Write', { file_path, content: 'x' }), st({ exists: false, binDir: '/kit/plugins/orch/bin/' }), on_)
  for (const p of ['/kit/agents/pwn.md', '/kit/skills/x/notes.md', '/kit/docs/commands/x.md', '/kit/plugins/orch/notes.md'])
    expect(kit(p), p).toMatch(/may Write only/)
  expect(kit('/kit/docs/design.md')).toBeUndefined()
  expect(kit('/repo/docs/hooks/x.md')).toBeUndefined() // outside any plugins/ path or the marketplace
})

test('Read and Write: a plain absolute ASCII spelling only; the placed path must pass too', () => {
  const guard = (tool: string, file_path: string, extra: Partial<OrchState> = {}) =>
    orchGuard(main(tool, { file_path, content: 'x' }), st({ exists: false, ...extra }), on_)
  // spellings the tool resolves differently from the string: relative, ~, padded, Unicode aliases of a name
  for (const p of ['.claude/agents/pwn.md', '.claude/rules/pwn.md', 'notes.md', '~/.claude/pwn.md', '~/cfg2/agents/pwn.md',
    ` ${SCRATCH}/r.md`, `${SCRATCH}/r.md `, '/repo/.claude/sKills/pwn/SKILL.md', '/repo/.claude/ſkills/pwn/SKILL.md',
    '/repo/.claude/commandſ/x.md', '/repo/.claude/hooKs/x.md', `${SCRATCH}/ré.md`, `${SCRATCH}/a\tb.md`, '']) {
    for (const tool of ['Read', 'Write']) expect(guard(tool, p), `${tool} ${JSON.stringify(p)}`).toMatch(/use a plain absolute ASCII path/)
  }
  // can't be placed: denied
  expect(guard('Write', `${SCRATCH}/r.md`, { placed: null })).toMatch(/can't be placed/)
  expect(guard('Read', `${SCRATCH}/r.md`, { placed: null })).toMatch(/can't be placed/)
  // where it lands decides too, against the dirs resolved alike
  const at = (path: string, configDir = CFG, binDir = BIN) => ({ placed: { path, configDir, binDir } })
  expect(guard('Write', '/repo/link/pwn/notes.md', at('/home/u/.claude/skills/pwn/notes.md'))).toMatch(/may Write only/) // symlink into skills
  expect(guard('Write', '/repo/cfglink/agents/pwn.md', at(`${CFG}/agents/pwn.md`))).toMatch(/may Write only/) // into the config dir
  expect(guard('Write', '/other/cfg2/agents/pwn.md', { ...at('/real/cfg2/agents/pwn.md', '/real/cfg2'), configDir: '/other/cfg2' })).toMatch(/may Write only/) // a non-default config dir, linked
  expect(guard('Write', '/repo/plug/agents/pwn.md', at('/p/agents/pwn.md'))).toMatch(/may Write only/) // into the plugin
  expect(guard('Write', '/repo/docs/Design.md', at('/repo/docs/design.md'))).toBeUndefined() // a case alias of a new file lands as a new file
  expect(guard('Read', '/repo/docs/x.md', at(`${CFG}/orch/-repo/tasks/T-1.md`))).toMatch(/may not run Read/) // the spelling fails
  expect(guard('Write', '/tmp/claude-501/-repo/s1/scratchpad/r.ts', at('/private/tmp/claude-501/-repo/s1/scratchpad/r.ts'))).toBeUndefined()
  expect(guard('Write', '/repo/docs/design.md', at('/repo/docs/design.md'))).toBeUndefined()
  expect(guard('Read', `${CFG}/handoffs/a.md`, at('/real/claude/handoffs/a.md', '/real/claude'))).toBeUndefined()
})

test('CronCreate and ScheduleWakeup: only /orch, /loop of an allowed prompt, a plain prompt, or a stop', () => {
  for (const tool of ['CronCreate', 'ScheduleWakeup']) {
    const sched = (args: Record<string, unknown>) => orchGuard(main(tool, args), st(), on_)
    // one assertion per accepted spelling of the command: bare and namespaced
    for (const prompt of ['/orch all', '/orch:orch all', '  /orch T-1 T-2', '/loop 20m /orch all', '/loop /orch:orch all',
      '/loop', 'check the deploy', 'look at /model docs']) {
      expect(sched({ prompt, cron: '*/20 * * * *', delaySeconds: 1200 }), prompt).toBeUndefined()
    }
    expect(sched({ cron: '*/20 * * * *' })).toBeUndefined()
    expect(sched({ prompt: '/model opus', stop: true })).toBeUndefined()
    for (const prompt of ['/model opus', ' /model opus', '/plugin disable orch@junk-drawer', '/loop 20m /model opus',
      '/loop /loop 5m /config', '/orch:init', '/orchestra', '/orch-init', '/handoff auto']) {
      expect(sched({ prompt, cron: '*/20 * * * *' }), prompt).toMatch(/may schedule only \/orch, \/loop or a plain prompt/)
    }
    expect(sched({ prompt: '/model opus', stop: false })).toMatch(/may schedule only/)
  }
})

test("Bash and Monitor: only the plugin's own bin/ scripts with plain arguments", () => {
  for (const c of [`${BIN}orch-state`, `"${BIN}orch-state"`, `'${BIN}orch-state' list`, `  ${BIN}orch-sync pull`, `${BIN}orch-state set T-1 done`,
    `${BIN}orch-worktree add T-1 task/T-1-x main`]) {
    expect(orchGuard(main('Bash', { command: c }), st(), on_), c).toBeUndefined()
    expect(orchGuard(main('Monitor', { command: c, description: 'd', timeout_ms: 1 }), st(), on_), c).toBeUndefined()
  }
  const escapes = ['git status', '/other/bin/orch-state', `${BIN}orch-state; git push`, `${BIN}orch-state $(rm -rf x)`, `${BIN}x && y`,
    `${BIN}../../../../usr/bin/git push --force origin main`, `${BIN}../../../../bin/sh -c 'git commit -am x'`,
    `${BIN}x/../../sh`, `${BIN}orch-state 'list'`, `"${BIN}orch-state list`, `"${BIN}orch-state  list`, `${BIN}orch-state list\ngit push`, `${BIN}orch-state list | sh`,
    `${BIN}orch-state list > /etc/x`, `${BIN}orch-state \`id\``, `${BIN}.hidden`, `${BIN}`,
    // a foreign command whose arguments name the bin dir: the dir must START the command
    `git push ${BIN}x`, `cat ${BIN}orch-state; rm -rf /`, `sh ${BIN}orch-state`, `x ${BIN}orch-state list`, `/p/bin2/${BIN}x`]
  for (const c of escapes) {
    expect(orchGuard(main('Bash', { command: c }), st(), on_), c).toMatch(/may not run Bash/)
    expect(orchGuard(main('Monitor', { command: c, description: 'd', timeout_ms: 1 }), st(), on_), c).toMatch(/may not run Monitor/)
  }
  expect(orchGuard(main('Bash', { command: `${BIN}x` }), st({ binDir: '' }), on_)).toMatch(/may not run Bash/)
  expect(orchGuard(main('Bash', {}), st(), on_)).toMatch(/may not run Bash/)
  expect(orchGuard(main('Monitor', { ws: { url: 'wss://x' }, description: 'd', timeout_ms: 1 }), st(), on_)).toBeUndefined()
})

test('Agent: only opus, sonnet or haiku, or an orch: type without a model; never a fork', () => {
  const agent = (args: Record<string, unknown>) => orchGuard(main('Agent', { prompt: 'p', description: 'd', ...args }), st(), on_)
  expect(agent({ subagent_type: 'fork' })).toMatch(/runs on the main loop's model or a costlier one\. Set model: opus\|sonnet\|haiku/)
  for (const args of [{ subagent_type: 'fork', model: 'sonnet' }, {}, { subagent_type: 'Explore' },
    { subagent_type: 'general-purpose', model: 'fable' }, { model: 'Fable' }, { model: 'inherit' }, { model: ' ' }, { model: '' },
    { subagent_type: 'orch:implementer', model: 'fable' }, { subagent_type: 'orch:orch-ops', model: 'inherit' }, { subagent_type: 'orchestra' },
    { subagent_type: 'orch' }, { model: 'opus-plus' }]) {
    expect(agent(args), JSON.stringify(args)).toMatch(/Set model: opus\|sonnet\|haiku/)
  }
  expect(agent({ model: 'sonnet' })).toBeUndefined()
  expect(agent({ model: 'haiku' })).toBeUndefined()
  expect(agent({ subagent_type: 'general-purpose', model: ' Opus ' })).toBeUndefined()
  expect(agent({ subagent_type: 'orch:orch-ops' })).toBeUndefined()
  expect(agent({ subagent_type: 'orch:implementer', model: 'haiku' })).toBeUndefined()
  expect(agent({ model: 'fable' })).toMatch(/needs the user's ask and allow_fable_agents on/)
  // allow_fable_agents (the user asked): an explicit fable or Fable id passes; a fork, inherit or no model still don't
  const allowed = (args: Record<string, unknown>) =>
    orchGuard(main('Agent', { prompt: 'p', description: 'd', ...args }), st(), { ...on_, allow_fable_agents: true })
  for (const args of [{ model: 'fable' }, { model: ' Fable ' }, { subagent_type: 'orch:implementer', model: FABLE }])
    expect(allowed(args), JSON.stringify(args)).toBeUndefined()
  for (const args of [{ subagent_type: 'fork' }, { subagent_type: 'fork', model: 'fable' }, { model: 'inherit' }, {}])
    expect(allowed(args), JSON.stringify(args)).toMatch(/Set model: opus\|sonnet\|haiku/)
})

test('agent.spawn: a fork, or a model resolving to a Fable, is refused on a Fable main loop', () => {
  const spawn = (args: Partial<Parameters<typeof orchSpawn>[0]>, o: OrchValues = on_) =>
    orchSpawn({ fork: false, subagentType: 'general-purpose', parentModel: FABLE, ...args }, o)
  expect(spawn({ fork: true, subagentType: 'fork' })).toMatch(/would run on the main loop's model \(a fork\)/)
  expect(spawn({})).toMatch(/would run on claude-fable-5-1/) // no model: the parent's
  expect(spawn({ model: 'inherit' })).toMatch(/would run on claude-fable-5-1/)
  expect(spawn({ model: 'fable' })).toMatch(/would run on fable/)
  expect(spawn({ subagentType: 'orch:implementer', model: 'fable' })).toMatch(/would run on fable/)
  expect(spawn({ model: 'opus' })).toBeUndefined()
  expect(spawn({ subagentType: 'orch:implementer' })).toBeUndefined() // pinned in its frontmatter
  expect(spawn({ subagentType: 'orch:implementer', model: 'inherit' })).toMatch(/would run on claude-fable-5-1/) // inherit = the parent's
  expect(spawn({ parentAgentId: 'a1' })).toBeUndefined() // a subagent's own spawn
  expect(spawn({}, { ...on_, guard: 'off' })).toBeUndefined()
  expect(spawn({ parentModel: OPUS })).toBeUndefined() // fable guard, Opus main loop
  expect(spawn({ fork: true, subagentType: 'fork', parentModel: OPUS }, { ...on_, guard: 'always' })).toMatch(/a fork/)
  expect(spawn({ parentModel: OPUS, model: 'fable' }, { ...on_, guard: 'always' })).toMatch(/would run on fable/)
  // allow_fable_agents: a Fable given explicitly passes; the parent's (no model, inherit) or a fork still doesn't
  const allow = { ...on_, allow_fable_agents: true }
  expect(spawn({ model: 'fable' }, allow)).toBeUndefined()
  expect(spawn({ subagentType: 'orch:implementer', model: FABLE }, allow)).toBeUndefined()
  expect(spawn({}, allow)).toMatch(/would run on claude-fable-5-1/)
  expect(spawn({ model: 'inherit' }, allow)).toMatch(/would run on claude-fable-5-1/)
  expect(spawn({ fork: true, subagentType: 'fork', model: 'fable' }, allow)).toMatch(/a fork/)
})

test('SendMessage: reviewers are always fresh, an implementer over the cap is replaced, an unknown target is refused', () => {
  const send = main('SendMessage', { to: 'a1', message: 'fix' })
  for (const type of ['verify-coordinator', 'orch:verify-coordinator', 'orch:ui-reviewer', 'ui-reviewer']) {
    expect(orchGuard(send, st({ agent: { type } }), on_), type).toMatch(/reviewers are always fresh: spawn a new one/)
  }
  expect(orchGuard(send, st({ agent: { type: 'orch:implementer-x' } }), on_)).toBeUndefined() // no reviewer by its name
  expect(orchGuard(send, st({ agent: { type: 'orch:ui-reviewer-x' } }), on_)).toBeUndefined()
  expect(orchGuard(send, st({ agent: { type: 'orch:implementer', tokens: 450_000 } }), on_)).toMatch(
    /implementer context 450k exceeds cap 400k: spawn a fresh implementer, hand it `git diff <base>...<branch>` and why previous rounds failed/,
  )
  // the exact bound: at the cap passes, one token over is refused
  expect(orchGuard(send, st({ agent: { type: 'orch:implementer', tokens: 400_000 } }), on_)).toBeUndefined()
  expect(orchGuard(send, st({ agent: { type: 'orch:implementer', tokens: 400_001 } }), on_)).toMatch(/implementer context 400k exceeds cap 400k/)
  expect(orchGuard(send, st({ agent: { type: 'orch:implementer', tokens: 300_000 } }), on_)).toBeUndefined()
  expect(orchGuard(send, st({ agent: { tokens: 300_000 } }), { ...on_, implementer_ctx_k: 250 })).toMatch(/exceeds cap 250k/)
  expect(orchGuard(send, st({ agent: { type: 'general-purpose' } }), on_)).toBeUndefined()
  expect(orchGuard(send, st({ agent: null }), on_)).toMatch(/no agent "a1" is known/)
})

test('settings: defaults for missing or wrong types, the number rows clamped to their bounds at load', () => {
  applyOrchSettings({})
  expect({ ...O }).toEqual({ guard: 'fable', allow_fable_agents: false, implementer_ctx_k: 400, ui_review: true, inject_rules: true, rounds: 3 })
  applyOrchSettings({ guard: 'always', implementer_ctx_k: 5000, allow_fable_agents: true, ui_review: false, inject_rules: false, rounds: 99 })
  expect({ ...O }).toEqual({ guard: 'always', allow_fable_agents: true, implementer_ctx_k: 1000, ui_review: false, inject_rules: false, rounds: 10 })
  applyOrchSettings({ guard: 'sometimes', implementer_ctx_k: 10.4, allow_fable_agents: 'yes', ui_review: 'no', inject_rules: 1, rounds: 0 })
  expect({ ...O }).toEqual({ guard: 'fable', allow_fable_agents: false, implementer_ctx_k: 50, ui_review: false, inject_rules: false, rounds: 1 })
  applyOrchSettings({ guard: 'off', implementer_ctx_k: '600', rounds: '2' })
  expect({ ...O }).toMatchObject({ guard: 'off', implementer_ctx_k: 600, rounds: 2 })
  applyOrchSettings({})
})

test('coerce: one check for every write path; the exact bounds of the number rows, one assertion per spelling', () => {
  for (const v of ['fable', 'always', 'off', ' Always ', 'OFF']) expect(coerce('guard', v).value, v).toBe(v.trim().toLowerCase())
  for (const v of ['sometimes', '', 1, true]) expect(coerce('guard', v).error, String(v)).toMatch(/not a valid guard/)
  for (const [n, ok] of [[50, true], [1000, true], [49, false], [1001, false], [-5, false], [400.5, false]] as const)
    expect(coerce('implementer_ctx_k', n).error === undefined, String(n)).toBe(ok)
  for (const [n, ok] of [[1, true], [10, true], [0, false], [11, false], [2.5, false]] as const)
    expect(coerce('rounds', n).error === undefined, String(n)).toBe(ok)
  expect(coerce('rounds', '4').value).toBe(4)
  for (const v of ['abc', '', ' ', null, undefined, true]) expect(coerce('rounds', v).error, String(v)).toMatch(/not a valid rounds/)
  for (const v of [true, 'true', 'on']) expect(coerce('ui_review', v).value, String(v)).toBe(true)
  for (const v of [false, 'false', 'off', 'yes', 1, 'maybe']) expect(coerce('inject_rules', v).value, String(v)).toBe(false)
})

test('transcriptTokens: the last usage record, its last iteration, input + cache-write + cache-read', () => {
  const line = (usage: unknown) => JSON.stringify({ message: { usage } })
  expect(transcriptTokens('')).toBeUndefined()
  expect(transcriptTokens('{"type":"user"}\nnot json "usage"\n')).toBeUndefined()
  expect(transcriptTokens([line({ input_tokens: 1, cache_read_input_tokens: 2 }), line({ input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 999 })].join('\n'))).toBe(60)
  expect(transcriptTokens(line({ iterations: [{ input_tokens: 1 }, { input_tokens: 5, cache_read_input_tokens: 5 }], input_tokens: 100 }))).toBe(10)
  expect(transcriptTokens(`${line({ input_tokens: 7 })}\n{"message":{"usage":"x"}}\n{broken "usage"`)).toBe(7) // a later bad line is skipped
})

test('every denial family starts with the prefix', () => {
  const s = st({ exists: true, agent: null })
  const texts = [
    orchGuard(main('Edit'), s, on_), orchGuard(main('mcp__x__y'), s, on_),
    orchGuard(main('Read', { file_path: '/repo/a.ts' }), s, on_),
    orchGuard(main('Write', { file_path: '/repo/a.ts' }), s, on_),
    orchGuard(main('Write', { file_path: 'rel.md' }), s, on_),
    orchGuard(main('Read', { file_path: '~/x.md' }), s, on_),
    orchGuard(main('Read', { file_path: `${SCRATCH}/r.md` }), st({ placed: null }), on_),
    orchGuard(main('Write', { file_path: `${SCRATCH}/r.md` }), st({ placed: null }), on_),
    orchGuard(main('CronCreate', { prompt: '/model opus' }), s, on_),
    orchGuard(main('ScheduleWakeup', { prompt: '/model opus' }), s, on_),
    orchGuard(main('Bash', { command: 'git push' }), s, on_),
    orchGuard(main('Monitor', { command: 'git push' }), s, on_),
    orchGuard(main('Agent', { subagent_type: 'fork' }), s, on_),
    orchGuard(main('Agent', { model: 'fable' }), s, on_),
    orchGuard(main('SendMessage', { to: 'x' }), s, on_),
    orchGuard(main('SendMessage', { to: 'x' }), st({ agent: { type: 'ui-reviewer' } }), on_),
    orchGuard(main('SendMessage', { to: 'x' }), st({ agent: { type: 'orch:implementer', tokens: 900_000 } }), on_),
    orchSpawn({ fork: true, subagentType: 'fork', parentModel: FABLE }, on_),
    orchSpawn({ fork: false, subagentType: 'general-purpose', parentModel: FABLE }, on_),
  ]
  expect(texts.length).toBe(19)
  for (const t of texts) expect(t).toMatch(/^Orchestrator mode \(orch\): \S/)
})

// ------------------------------------------------------------------ the module

type Agent = { id: string; type: string; name?: string }
const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]
const PANE = {
  component: 'Pane',
  requestId: 'orch',
  props: { title: 'orch', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

function world(on: On) {
  const env: Record<string, string> = { HOME: '/home/u', CLAUDE_CONFIG_DIR: CFG }
  const files: Record<string, string> = {}
  const rec = { model: FABLE as string | undefined, agents: [] as Agent[], files, toasts: [] as string[],
    links: {} as Record<string, string>, dangling: {} as Record<string, string[]>, nowhere: [] as string[], envFails: false,
    config: [] as { key: string; value: unknown }[], opened: [] as string[], focus: [] as (true | undefined)[], closed: [] as string[], runs: [] as string[][],
    existsFails: false, writeFails: false, notPlaced: false }
  on('env.get', (_$, e) => {
    if (rec.envFails) throw new Error('env unavailable')
    return { value: env[e.name] }
  })
  // A listed file, or a folder (a last name with no extension) outside /missing; realPath through `links`, and a
  // link into /missing leads nowhere (stat follows it). `dangling` names links to nothing per folder, as fs.list
  // (an lstat) shows them.
  on('fs.stat', (_$, e) => {
    const p = e.path.length > 1 ? e.path.replace(/\/$/, '') : e.path
    if (rec.nowhere.includes(p)) return { value: { kind: 'other' as const, size: 0, mtimeMs: 0, isLink: true } } // the engine's own shape
    const isFile = p in files
    const realPath = Object.entries(rec.links).reduce((q, [from, to]) => (q === from || q.startsWith(`${from}/`) ? to + q.slice(from.length) : q), p)
    if (!isFile && (/[^/]\.[A-Za-z0-9]+$/.test(p) || realPath.startsWith('/missing'))) throw new Error(`ENOENT ${p}`)
    return { value: { kind: isFile ? ('file' as const) : ('dir' as const), size: 0, mtimeMs: 0, isLink: false, realPath } }
  })
  on('fs.list', (_$, e) => ({
    value: (rec.dangling[e.path ?? ''] ?? []).map(name => ({ name, kind: 'other' as const, size: 0, mtimeMs: 0, isLink: true })),
  }))
  on('session.model', () => {
    if (rec.model === undefined) throw new Error('no model')
    return { value: rec.model }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.toast', (_$, e) => { rec.toasts.push(e.text); return { value: undefined } })
  on('ui.open', (_$, e) => { rec.opened.push(e.id); rec.focus.push(e.focus); return { value: rec.notPlaced ? { isPlaced: false as const, reason: 'no room' } : { isPlaced: true as const } } })
  on('ui.close', (_$, e) => { rec.closed.push(e.id); return { value: undefined } })
  on('ui.focus', () => ({}))
  on('config.set', (_$, e) => { rec.config.push({ key: e.key, value: e.value }); return { value: e.value } })
  on('agent.list', () => ({ value: rec.agents.map(a => ({ description: '', status: 'completed' as const, ...a })) }))
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  on('fs.exists', (_$, e) => {
    if (rec.existsFails) throw new Error('EACCES')
    return { value: e.path in files }
  })
  on('fs.read', (_$, e) => {
    if (!(e.path in files)) throw new Error('ENOENT')
    return { value: files[e.path]! }
  })
  on('fs.write', (_$, e) => {
    if (rec.writeFails) throw new Error('EROFS')
    files[e.path] = e.text
    return { value: undefined }
  })
  on('process.run', (_$, e) => {
    rec.runs.push([...e.argv])
    if (e.argv[0] === 'rm') delete files[e.argv.at(-1)!]
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('classic.SubagentStop', () => ({}))
  // The engine's own drawing where the mod passes.
  on('ui.render', ($, e) => $.ui.resolve(e).Box({ key: 'engine' }))
  return rec
}

const start = ($: Engine) => $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
const orchCmd = ($: Engine, args: string) =>
  $.command.run({ command: 'orch:orch', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
// What a denied call carries: `deny` for a plugin's call, the errored `text` for the engine's.
const denial = (r: unknown) => {
  const o = r as { deny?: string; isError?: boolean; text?: string }
  return o.deny ?? (o.isError ? o.text : undefined)
}
const edit = ($: Engine) => $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' })
const fetch = ($: Engine) => $.tool.call({ tool: 'WebFetch', url: 'https://x', prompt: 'p' })

// A frame plugin beside orch, as T5 will be: `/frame <method> [json]` calls `$.orch.<method>` (or `$.config.set` for
// `config`, the /config menu's own path) and answers what came back (an inline plugin closes over nothing, so the
// command carries the result out as text).
const FRAME: Plugin = {
  name: 'frame',
  register(on) {
    on('command.run', { command: 'frame' }, async ($, e) => {
      const [method = '', ...rest] = e.args.trim().split(/\s+/)
      const input = rest.length ? JSON.parse(rest.join(' ')) : undefined
      try {
        // The host lets a noun's method be called, never read, so "exists" means "answers a call".
        if (method === 'members') {
          const answered: string[] = []
          if (Array.isArray(await $.orch.schema())) answered.push('schema')
          if (typeof (await $.orch.get({ key: 'rounds' })) === 'number') answered.push('get')
          if (typeof (await $.orch.set({ key: 'rounds', value: await $.orch.get({ key: 'rounds' }) })) === 'number') answered.push('set')
          await $.orch.open()
          await $.orch.open()
          answered.push('open')
          await $.orch.show()
          answered.push('show')
          await $.orch.hide()
          answered.push('hide')
          if (typeof (await $.orch.guardState()).active === 'boolean') answered.push('guardState')
          return { text: JSON.stringify({ ok: answered }) }
        }
        if (method === 'schema') return { text: JSON.stringify({ ok: await $.orch.schema() }) }
        if (method === 'get') return { text: JSON.stringify({ ok: await $.orch.get(input) }) }
        if (method === 'set') return { text: JSON.stringify({ ok: await $.orch.set(input) }) }
        if (method === 'open') return { text: JSON.stringify({ ok: await $.orch.open() }) }
        if (method === 'show') return { text: JSON.stringify({ ok: await $.orch.show(input) }) }
        if (method === 'hide') return { text: JSON.stringify({ ok: await $.orch.hide(input) }) }
        if (method === 'guardState') return { text: JSON.stringify({ ok: await $.orch.guardState() }) }
        if (method === 'config') return { text: JSON.stringify({ ok: await $.config.set(input) }) }
        // another plugin's own tool calls and spawns: the guard is for the model's, not these
        if (method === 'edit') return { text: JSON.stringify({ ok: await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' }) }) }
        if (method === 'bash') return { text: JSON.stringify({ ok: await $.tool.call({ tool: 'Bash', command: 'git push --force' }) }) }
        if (method === 'spawn') return { text: JSON.stringify({ ok: await $.agent.spawn({ prompt: 'p', description: 'd', subagentType: 'general-purpose', model: 'fable' }) }) }
        return { text: JSON.stringify({ error: `no method ${method}` }) }
      } catch (err) {
        return { text: JSON.stringify({ error: String((err as Error).message ?? err) }) }
      }
    })
  },
}
const WITH_FRAME = { plugins: [FRAME] }
async function frame($: Engine, method: string, input?: unknown): Promise<unknown> {
  const args = input === undefined ? method : `${method} ${JSON.stringify(input)}`
  const r = (await $.command.run({ command: 'frame', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })) as { text?: string }
  const out = JSON.parse(r.text ?? '{}') as { ok?: unknown; error?: string }
  if (out.error !== undefined) throw new Error(out.error)
  return out.ok
}

test('AC8: the live model decides, so a /model switch counts at once; a subagent passes; always holds Opus; off never denies', WITH_FRAME, async ($, on) => {
  const rec = world(on)
  await start($)
  expect(denial(await edit($))).toMatch(/^Orchestrator mode \(orch\): the main loop may not run Edit/)
  expect(denial(await $.tool.call({ tool: 'Read', file_path: `${SCRATCH}/r.md` }))).toBeUndefined()
  expect(denial(await $.tool.call({ tool: 'Write', file_path: '/repo/docs/new.md', content: '# x' }))).toBeUndefined() // new .md
  rec.files['/repo/docs/old.md'] = '# old'
  expect(denial(await $.tool.call({ tool: 'Write', file_path: '/repo/docs/old.md', content: '# x' }))).toMatch(/ask the user for a target path/)
  // A subagent's call carries its loop's agentId (ToolCallInput's AgentLoop), which $.tool.call's type leaves out.
  const sub = { tool: 'Edit', agentId: 'a1', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' } as unknown as Parameters<Engine['tool']['call']>[0]
  expect(denial(await $.tool.call(sub))).toBeUndefined()
  rec.model = OPUS // /model switch: read live, no restart
  expect(denial(await edit($))).toBeUndefined()
  expect(await frame($, 'guardState')).toEqual({ active: false, model: OPUS })
  rec.model = FABLE
  expect(denial(await edit($))).toMatch(/may not run Edit/)
  expect(await frame($, 'guardState')).toEqual({ active: true, model: FABLE })

  await frame($, 'set', { key: 'guard', value: 'always' })
  rec.model = OPUS
  expect(denial(await fetch($))).toMatch(/may not run WebFetch/)
  expect(await frame($, 'guardState')).toEqual({ active: true, model: OPUS })
  await frame($, 'set', { key: 'guard', value: 'off' })
  expect(denial(await fetch($))).toBeUndefined()
  rec.model = FABLE
  expect(denial(await fetch($))).toBeUndefined()
  expect(denial(await edit($))).toBeUndefined()
  expect(await frame($, 'guardState')).toEqual({ active: false, model: FABLE })
  await frame($, 'set', { key: 'guard', value: 'fable' })
  expect(denial(await fetch($))).toMatch(/may not run WebFetch/)
})

test("AC8: another plugin's $.tool.call and $.agent.spawn pass on a guarded Fable main loop; the engine's own are denied", WITH_FRAME, async ($, on) => {
  world(on)
  on('agent.spawn', (_$, e) => ({ model: e.model ?? 'opus', agentId: 'sub-1' }))
  await start($)
  expect(denial(await edit($))).toMatch(/may not run Edit/)
  expect(denial(await frame($, 'edit'))).toBeUndefined()
  expect(denial(await frame($, 'bash'))).toBeUndefined()
  expect((await frame($, 'spawn') as { deny?: string }).deny).toBeUndefined() // a Fable model the guard would refuse the model's own spawn
  expect((await $.agent.spawn({ tool_use_id: 'tu1', prompt: 'p', description: 'd', subagentType: 'fork', provider: { plugin: 'engine', tier: 'core' }, parentModel: FABLE, background: true, fork: true })).deny).toMatch(/a fork/)
})

test("AC8: with guard always, another plugin's spawn of a Fable model passes where the model's own is refused", { ...WITH_FRAME, options: { guard: 'always' } }, async ($, on) => {
  world(on)
  on('agent.spawn', (_$, e) => ({ model: e.model ?? 'opus', agentId: 'sub-1' }))
  await start($)
  expect((await $.agent.spawn({ tool_use_id: 'tu1', prompt: 'p', description: 'd', subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' }, parentModel: OPUS, model: 'fable', background: true, fork: false })).deny).toMatch(/would run on fable/)
  expect((await frame($, 'spawn') as { deny?: string }).deny).toBeUndefined()
})

test('a Read whose spelling is a root but which lands outside (handoffs linked out) is denied', async ($, on) => {
  const rec = world(on)
  await start($)
  expect(denial(await $.tool.call({ tool: 'Read', file_path: `${CFG}/handoffs/a.md` }))).toBeUndefined()
  rec.links[`${CFG}/handoffs`] = '/repo/src'
  expect(denial(await $.tool.call({ tool: 'Read', file_path: `${CFG}/handoffs/a.md` }))).toMatch(/may not run Read/)
})

test('a named agent that left the list is still known by name through its record', async ($, on) => {
  const rec = world(on)
  await start($)
  rec.agents = [{ id: 'imp1', type: 'orch:implementer', name: 'impl' }]
  rec.files['/t/imp1.jsonl'] = `${JSON.stringify({ message: { usage: { input_tokens: 500_000 } } })}\n`
  await $.classic.SubagentStop({ agent_id: 'imp1', agent_type: 'orch:implementer', agent_transcript_path: '/t/imp1.jsonl', stop_hook_active: false })
  rec.agents = []
  expect(denial(await $.tool.call({ tool: 'SendMessage', to: 'impl', message: 'x' }))).toMatch(/exceeds cap 400k/)
  expect(denial(await $.tool.call({ tool: 'SendMessage', to: 'imp1', message: 'x' }))).toMatch(/exceeds cap 400k/)
})

test('a Write whose existence cannot be read is treated as existing: a new .md outside the roots is then denied', async ($, on) => {
  const rec = world(on)
  await start($)
  expect(denial(await $.tool.call({ tool: 'Write', file_path: '/repo/docs/new.md', content: '# x' }))).toBeUndefined()
  rec.existsFails = true
  expect(denial(await $.tool.call({ tool: 'Write', file_path: '/repo/docs/new.md', content: '# x' }))).toMatch(/may Write only/)
  expect(denial(await $.tool.call({ tool: 'Write', file_path: `${SCRATCH}/r.md`, content: '# x' }))).toBeUndefined() // a root needs no answer
})

test('a session start whose flag write fails still starts', { options: { inject_rules: false } }, async ($, on) => {
  const rec = world(on)
  rec.writeFails = true
  await start($)
  expect(Object.keys(rec.files)).toEqual([])
})

test('a pane the surface could not place is not open: the next toggle opens again', WITH_FRAME, async ($, on) => {
  const rec = world(on)
  rec.notPlaced = true
  await start($)
  await frame($, 'open')
  await frame($, 'open')
  expect(rec.opened).toEqual(['orch', 'orch'])
  expect(rec.closed).toEqual([])
})

test('the guard option the engine fills in from the manifest holds at load', { ...WITH_FRAME, options: { guard: 'always' } }, async ($, on) => {
  const rec = world(on)
  rec.model = OPUS
  await start($)
  expect(denial(await edit($))).toMatch(/may not run Edit/)
  expect(await frame($, 'get', { key: 'guard' })).toBe('always')
})

test('SendMessage target from the agent list or the SubagentStop record (type and transcript tokens)', { ...WITH_FRAME, options: { implementer_ctx_k: 300 } }, async ($, on) => {
  const rec = world(on)
  await start($)
  const send = (to: string) => $.tool.call({ tool: 'SendMessage', to, message: 'fix the failing criteria' })
  rec.agents = [{ id: 'rev1', type: 'orch:verify-coordinator' }, { id: 'imp1', type: 'orch:implementer', name: 'impl' }, { id: 'ui1', type: 'ui-reviewer' }]
  expect(denial(await send('rev1'))).toMatch(/reviewers are always fresh/)
  expect(denial(await send('ui1'))).toMatch(/ui-reviewer is a reviewer/)
  expect(denial(await send('imp1'))).toBeUndefined() // no record yet: tokens unknown
  const usage = (n: number) => `${JSON.stringify({ message: { usage: { input_tokens: n } } })}\n`
  rec.files['/t/imp1.jsonl'] = usage(320_000)
  await $.classic.SubagentStop({ agent_id: 'imp1', agent_type: 'orch:implementer', agent_transcript_path: '/t/imp1.jsonl', stop_hook_active: false })
  expect(denial(await send('impl'))).toMatch(/implementer context 320k exceeds cap 300k/) // by name
  expect(denial(await send('imp1'))).toMatch(/exceeds cap 300k/) // by id
  expect(denial(await send('rev1 [123]'))).toMatch(/reviewers are always fresh/) // ListAgents' " [ref]" dropped
  rec.files['/t/gone.jsonl'] = usage(1000)
  await $.classic.SubagentStop({ agent_id: 'gone', agent_type: 'orch:ui-reviewer', agent_transcript_path: '/t/gone.jsonl', stop_hook_active: false })
  expect(denial(await send('gone'))).toMatch(/reviewers are always fresh/) // not in the list: the record answers
  rec.files['/t/fixer.jsonl'] = usage(350_000)
  await $.classic.SubagentStop({ agent_id: 'fixer', agent_type: 'orch:implementer', agent_transcript_path: '/t/fixer.jsonl', stop_hook_active: false })
  expect(denial(await send('fixer'))).toMatch(/exceeds cap 300k/)
  rec.files['/t/small.jsonl'] = usage(300_000) // at the cap: passes
  await $.classic.SubagentStop({ agent_id: 'small', agent_type: 'orch:implementer', agent_transcript_path: '/t/small.jsonl', stop_hook_active: false })
  expect(denial(await send('small'))).toBeUndefined()
  await $.classic.SubagentStop({ agent_id: 'noread', agent_type: 'orch:implementer', agent_transcript_path: '/t/none.jsonl', stop_hook_active: false })
  expect(denial(await send('noread'))).toBeUndefined() // an unreadable transcript: tokens unknown, the type known
  // an agent that stopped before the list named it: its record is by id, the list's name leads to it
  rec.files['/t/late.jsonl'] = usage(330_000)
  await $.classic.SubagentStop({ agent_id: 'late', agent_type: 'orch:implementer', agent_transcript_path: '/t/late.jsonl', stop_hook_active: false })
  rec.agents.push({ id: 'late', type: 'orch:implementer', name: 'latename' })
  expect(denial(await send('latename'))).toMatch(/exceeds cap 300k/)
  expect(denial(await send('nobody'))).toMatch(/no agent "nobody" is known/)
  expect(denial(await send('../../x'))).toMatch(/no agent/) // never read as a path
  await frame($, 'set', { key: 'implementer_ctx_k', value: 400 })
  expect(denial(await send('fixer'))).toBeUndefined() // the cap is read live
})

test('an unreadable model toasts once and the fable guard passes', async ($, on) => {
  const rec = world(on)
  await start($)
  expect(denial(await fetch($))).toMatch(/may not run WebFetch/)
  rec.model = undefined
  expect(denial(await fetch($))).toBeUndefined()
  expect(denial(await fetch($))).toBeUndefined()
  expect(rec.toasts).toEqual(['orch: the main-loop model could not be read, so the fable guard is off this session'])
})

test('guard always needs no model: an unreadable one still denies and nothing is toasted', { options: { guard: 'always' } }, async ($, on) => {
  const rec = world(on)
  rec.model = undefined
  await start($)
  expect(denial(await fetch($))).toMatch(/may not run WebFetch/)
  expect(rec.toasts).toEqual([])
})

test('a Read or Write is placed first; through a link into loaded config, or unplaceable, it is denied', async ($, on) => {
  const rec = world(on)
  await start($)
  const write = (file_path: string) => $.tool.call({ tool: 'Write', file_path, content: '# x' })
  expect(denial(await write('/repo/docs/new.md'))).toBeUndefined()
  rec.links['/repo/link'] = '/home/u/.claude/skills'
  expect(denial(await write('/repo/link/pwn/notes.md'))).toMatch(/may Write only/)
  rec.links['/repo/cfglink'] = CFG
  expect(denial(await write('/repo/cfglink/agents/pwn.md'))).toMatch(/may Write only/)
  expect(denial(await write('/missing/dir/x.md'))).toMatch(/can't be placed/)
  expect(denial(await write('.claude/rules/pwn.md'))).toMatch(/use a plain absolute ASCII path/)
  rec.links['/repo/scratch'] = SCRATCH
  expect(denial(await $.tool.call({ tool: 'Read', file_path: '/repo/scratch/r.md' }))).toMatch(/may not run Read/) // its spelling isn't a root
  // a link that leads nowhere: Write would create its target (say ~/.claude/agents/x.md), so it can't be placed
  rec.dangling['/repo/docs'] = ['pwn.md']
  expect(denial(await write('/repo/docs/pwn.md'))).toMatch(/can't be placed .*a link to nothing/)
  expect(denial(await write('/repo/docs/PWN.md'))).toMatch(/can't be placed/) // case-blind, as macOS resolves it
  expect(denial(await write('/repo/docs/other.md'))).toBeUndefined()
  rec.nowhere.push('/repo/docs/pwn2.md') // stat resolves with no realPath: it leads nowhere
  expect(denial(await write('/repo/docs/pwn2.md'))).toMatch(/can't be placed/)
  rec.links['/repo/gone'] = '/missing/target' // a folder that links to nothing
  expect(denial(await write('/repo/gone/x.md'))).toMatch(/can't be placed/)
  // another plugin's loaded dirs, spelled so or through a link
  expect(denial(await write('/kit/plugins/other/agents/pwn.md'))).toMatch(/may Write only/)
  rec.links['/repo/plug'] = '/kit/plugins/other'
  expect(denial(await write('/repo/plug/agents/pwn.md'))).toMatch(/may Write only/)
})

test('a guard hook that throws refuses on a guarded main loop, and passes with the guard off or in a subagent', WITH_FRAME, async ($, on) => {
  const rec = world(on)
  await start($)
  rec.envFails = true // the config dir can't be read: orchCheck throws
  expect(denial(await $.tool.call({ tool: 'Read', file_path: `${SCRATCH}/r.md` }))).toMatch(/^Orchestrator mode \(orch\): guard error$/)
  const sub = { tool: 'Read', agentId: 'a1', file_path: '/repo/a.ts' } as unknown as Parameters<Engine['tool']['call']>[0]
  expect(denial(await $.tool.call(sub))).toBeUndefined()
  rec.envFails = false
  await frame($, 'set', { key: 'guard', value: 'off' })
  rec.envFails = true
  expect(denial(await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' }))).toBeUndefined()
})

test('agent.spawn refuses a fork or a Fable model on the main loop; a subagent\'s spawn passes', async ($, on) => {
  world(on)
  on('agent.spawn', (_$, e) => ({ model: e.model ?? 'opus', agentId: 'sub-1' }))
  await start($)
  const spawn = (e: Partial<Args<'agent.spawn'>>) => $.agent.spawn({ tool_use_id: 'tu1', prompt: 'p', description: 'd',
    subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' }, parentModel: FABLE, background: true, fork: false, ...e })
  expect((await spawn({ model: 'fable' })).deny).toMatch(/would run on fable/)
  expect((await spawn({ subagentType: 'orch:implementer', model: 'fable' })).deny).toMatch(/would run on fable/)
  expect((await spawn({ fork: true, subagentType: 'fork' })).deny).toMatch(/a fork/)
  expect((await spawn({})).deny).toMatch(/would run on claude-fable-5-1/)
  expect(await spawn({ model: 'sonnet' })).toMatchObject({ agentId: 'sub-1' })
  expect(await spawn({ subagentType: 'orch:implementer' })).toMatchObject({ agentId: 'sub-1' })
  expect(await spawn({ model: 'fable', parentAgentId: 'a1' })).toMatchObject({ agentId: 'sub-1' })
})

test('allow_fable_agents on lets an explicit Fable through both the Agent rule and agent.spawn; off refuses', { ...WITH_FRAME, options: { allow_fable_agents: true } }, async ($, on) => {
  world(on)
  on('agent.spawn', (_$, e) => ({ model: e.model ?? 'opus', agentId: 'sub-1' }))
  await start($)
  const spawn = (e: Partial<Args<'agent.spawn'>>) => $.agent.spawn({ tool_use_id: 'tu1', prompt: 'p', description: 'd',
    subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' }, parentModel: FABLE, background: true, fork: false, ...e })
  const agent = (model: 'fable') => $.tool.call({ tool: 'Agent', prompt: 'p', description: 'd', subagent_type: 'general-purpose', model })
  expect(denial(await agent('fable'))).toBeUndefined()
  expect(await spawn({ model: 'fable' })).toMatchObject({ agentId: 'sub-1' })
  expect((await spawn({})).deny).toMatch(/would run on claude-fable-5-1/) // the parent's model: not an explicit ask
  await frame($, 'set', { key: 'allow_fable_agents', value: false })
  expect(denial(await agent('fable'))).toMatch(/allow_fable_agents on/)
  expect((await spawn({ model: 'fable' })).deny).toMatch(/would run on fable/)
})

// ------------------------------------------------------------------ $.orch and the pane

const MANIFEST_KEYS = ['guard', 'allow_fable_agents', 'implementer_ctx_k', 'ui_review', 'inject_rules', 'rounds']

test('$.orch: the seven calls exist; schema mirrors the manifest; get answers the defaults; guard is the choice row', WITH_FRAME, async ($, on) => {
  world(on)
  await start($)
  expect(await frame($, 'members')).toEqual(['schema', 'get', 'set', 'open', 'show', 'hide', 'guardState'])
  const schema = (await frame($, 'schema')) as { key: string; type: string; title: string; default: unknown; main: boolean; options?: string[] }[]
  expect(schema.map(f => f.key)).toEqual(MANIFEST_KEYS)
  for (const f of schema) {
    expect(typeof f.default, f.key).toBe(f.type)
    expect(f.title, f.key).toMatch(/\S/)
    expect(await frame($, 'get', { key: f.key }), `get(${f.key}) is the manifest default`).toBe(f.default)
  }
  expect(schema.find(f => f.key === 'guard')?.options).toEqual(['fable', 'always', 'off'])
  expect(schema.filter(f => f.main).map(f => f.key)).toEqual(['guard', 'allow_fable_agents', 'implementer_ctx_k'])
  await expect(frame($, 'get', { key: 'nope' })).rejects.toThrow(/no setting nope/)
})

test('$.orch.set writes orch.<key> through $.config and get reads it back; a bad value, scope, key or a denied row is refused', WITH_FRAME, async ($, on) => {
  on('config.set', { key: 'orch.rounds', value: 9 }, () => ({ deny: 'locked' })) // one write a hook refuses
  const rec = world(on)
  await start($)
  expect(await frame($, 'set', { key: 'guard', value: 'always' })).toBe('always')
  expect(rec.config).toEqual([{ key: 'orch.guard', value: 'always' }])
  expect(await frame($, 'get', { key: 'guard' })).toBe('always')
  expect(await frame($, 'set', { key: 'ui_review', value: 'off', scope: 'user' })).toBe(false)
  expect(rec.config.at(-1)).toEqual({ key: 'orch.ui_review', value: false })
  expect(await frame($, 'set', { key: 'allow_fable_agents', value: 'on' })).toBe(true)
  expect(await frame($, 'get', { key: 'allow_fable_agents' })).toBe(true)
  // the exact bounds: in at 50, 1000, 1, 10; out one past each, and -5
  expect(await frame($, 'set', { key: 'implementer_ctx_k', value: 50 })).toBe(50)
  expect(await frame($, 'set', { key: 'implementer_ctx_k', value: 1000 })).toBe(1000)
  expect(await frame($, 'set', { key: 'rounds', value: 1 })).toBe(1)
  expect(await frame($, 'set', { key: 'rounds', value: '10' })).toBe(10)
  const writes = rec.config.length
  for (const [key, value] of [['implementer_ctx_k', 49], ['implementer_ctx_k', 1001], ['implementer_ctx_k', -5], ['implementer_ctx_k', 400.5],
    ['rounds', 0], ['rounds', 11], ['rounds', 'abc'], ['guard', 'sometimes']] as const) {
    await expect(frame($, 'set', { key, value }), `${key}=${String(value)}`).rejects.toThrow(/not a valid/)
  }
  await expect(frame($, 'set', { key: 'rounds', value: 2, scope: 'project' })).rejects.toThrow(/scope project/)
  await expect(frame($, 'set', { key: 'nope', value: 1 })).rejects.toThrow(/no setting nope/)
  expect(rec.config.length).toBe(writes) // none of the refusals reached $.config
  expect(await frame($, 'get', { key: 'rounds' })).toBe(10)
  expect(await frame($, 'get', { key: 'implementer_ctx_k' })).toBe(1000)
  // a config.set hook's deny comes back as the refusal and the value stays
  await expect(frame($, 'set', { key: 'rounds', value: 9 })).rejects.toThrow(/locked/)
  expect(await frame($, 'get', { key: 'rounds' })).toBe(10)
})

test('a write to an orch row by the /config menu, not $.orch.set, is validated the same way and lands in get', WITH_FRAME, async ($, on) => {
  const rec = world(on)
  await start($)
  await frame($, 'config', { key: 'orch.guard', value: 'off' })
  expect(await frame($, 'get', { key: 'guard' })).toBe('off')
  expect(denial(await edit($))).toBeUndefined()
  await frame($, 'config', { key: 'orch.rounds', value: 7 })
  expect(await frame($, 'get', { key: 'rounds' })).toBe(7)
  const rows = rec.config.length
  for (const [key, value] of [['orch.rounds', 0], ['orch.rounds', 11], ['orch.rounds', 'abc'], ['orch.guard', 'maybe'], ['orch.implementer_ctx_k', 49]] as const) {
    const r = (await frame($, 'config', { key, value })) as { deny?: string }
    expect(r.deny, `${key}=${String(value)}`).toMatch(/not a valid/)
  }
  expect(rec.config.length).toBe(rows)
  expect(await frame($, 'get', { key: 'rounds' })).toBe(7)
  await frame($, 'config', { key: 'other.rounds', value: 0 }) // another plugin's row passes untouched
  expect(rec.config.at(-1)).toEqual({ key: 'other.rounds', value: 0 })
  expect((await frame($, 'config', { key: 'orch.nope', value: 'x' })) as { deny?: string }).toEqual({ value: 'x' }) // an orch row this version lacks: not ours to judge
  expect(rec.config.at(-1)).toEqual({ key: 'orch.nope', value: 'x' })
})

test('inject_rules mirrors into the flag file scripts/orch-context.sh checks: off writes it, on removes it, session start syncs it', { ...WITH_FRAME, options: { inject_rules: false } }, async ($, on) => {
  const rec = world(on)
  await start($)
  const FLAG = `${CFG}/orch/rules-off`
  expect(FLAG in rec.files, 'off at load: the flag is written at session start').toBe(true)
  await frame($, 'set', { key: 'inject_rules', value: true })
  expect(rec.runs.at(-1)).toEqual(['rm', '-f', '--', FLAG])
  expect(FLAG in rec.files).toBe(false)
  await frame($, 'config', { key: 'orch.inject_rules', value: false }) // the /config menu's path
  expect(FLAG in rec.files).toBe(true)
  await frame($, 'set', { key: 'inject_rules', value: 'on' })
  expect(FLAG in rec.files).toBe(false)
})

test('a denied inject_rules write leaves the flag file alone', WITH_FRAME, async ($, on) => {
  on('config.set', { key: 'orch.inject_rules' }, () => ({ deny: 'locked' }))
  const rec = world(on)
  await start($)
  await expect(frame($, 'set', { key: 'inject_rules', value: false })).rejects.toThrow(/locked/)
  expect(`${CFG}/orch/rules-off` in rec.files).toBe(false)
  expect(await frame($, 'get', { key: 'inject_rules' })).toBe(true)
})

test('/orch panel and $.orch.open toggle the pane; q closes it; a plain /orch passes down', WITH_FRAME, async ($, on) => {
  const rec = world(on)
  on('command.run', { command: 'orch:orch' }, (_$, e) => ({ text: `downstream ${e.args}` }))
  await start($)
  expect((await orchCmd($, 'all --rounds 2')) as { text?: string }).toMatchObject({ text: 'downstream all --rounds 2' })
  expect(rec.opened).toEqual([])
  await orchCmd($, 'panel')
  expect(rec.opened).toEqual(['orch'])
  await orchCmd($, ' panel ')
  expect(rec.closed).toEqual(['orch'])
  await frame($, 'open')
  expect(rec.opened).toEqual(['orch', 'orch'])
  await frame($, 'open')
  expect(rec.closed).toEqual(['orch', 'orch'])
  await orchCmd($, 'panel')
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'orch', surface, ...PANE })
    const close = (await ui.findAll({ type: 'Button' })).find(b => b.props.hotkey === 'q')
    expect(close?.key, 'q closes').toBe('close')
    await ui.press({ key: close!.key! })
    await ui.unmount()
  }
  expect(rec.closed.length).toBe(4)
  await orchCmd($, 'panel') // closed by q: the next toggle opens
  expect(rec.opened.length).toBe(4)
})

// A close of the pane from outside the module, as the person's mark or ctrl+x x is to it: `/shut` closes it through
// another plugin's `$.ui.close`, which reaches the pane's own ui.close hook.
const SHUTTER: Plugin = {
  name: 'shutter',
  register(on) {
    on('command.run', { command: 'shut' }, async $ => { await $.ui.close({ id: 'orch' }); return {} })
  },
}
const shut = ($: Engine) => $.command.run({ command: 'shut', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })

test('$.orch.show opens and never closes; focus as asked', WITH_FRAME, async ($, on) => {
  const rec = world(on)
  await start($)
  await frame($, 'show', { owner: 'junkd' })
  expect(rec.opened).toEqual(['orch'])
  expect(rec.focus).toEqual([undefined]) // no focus asked: the caller keeps the keys
  await frame($, 'show', { owner: 'junkd' }) // up already: asked again, never closed
  expect(rec.opened).toEqual(['orch', 'orch'])
  expect(rec.closed).toEqual([])

  await frame($, 'hide')
  expect(rec.closed).toEqual(['orch'])
  await frame($, 'show')
  expect(rec.opened).toHaveLength(3)

  await frame($, 'show', { focus: true })
  expect(rec.focus.at(-1)).toBe(true)
  await orchCmd($, 'panel') // its own toggle: closes the pane show left up
  expect(rec.closed).toHaveLength(2)
  await orchCmd($, 'panel')
  expect(rec.focus.at(-1)).toBe(true) // its own command still asks for the keys
})

test('$.orch.hide with an owner closes only the pane that owner showed, while nothing reopened or closed it since', { plugins: [FRAME, SHUTTER] }, async ($, on) => {
  const rec = world(on)
  await start($)
  await frame($, 'show', { owner: 'junkd' })
  await frame($, 'hide', { owner: 'other' }) // another owner: left up
  expect(rec.closed).toEqual([])
  await frame($, 'hide', { owner: 'junkd' })
  expect(rec.closed).toEqual(['orch'])

  // Closed by its own command: no longer the owner's, so hide leaves it alone; opened on its own: not the owner's.
  await frame($, 'show', { owner: 'junkd' })
  await orchCmd($, 'panel')
  expect(rec.closed).toHaveLength(2)
  await frame($, 'hide', { owner: 'junkd' })
  expect(rec.closed).toHaveLength(2)
  await orchCmd($, 'panel')
  await frame($, 'hide', { owner: 'junkd' })
  expect(rec.closed).toHaveLength(2)
  await frame($, 'hide') // no owner: closes whatever is up
  expect(rec.closed).toHaveLength(3)

  // The person's close clears the mark too.
  await frame($, 'show', { owner: 'junkd' })
  await shut($)
  expect(rec.closed).toHaveLength(4)
  await frame($, 'hide', { owner: 'junkd' })
  expect(rec.closed).toHaveLength(4)

  // A show without an owner takes the mark away as well.
  await frame($, 'show', { owner: 'junkd' })
  await frame($, 'show', {})
  await frame($, 'hide', { owner: 'junkd' })
  expect(rec.closed).toHaveLength(4)
  await frame($, 'hide')
  expect(rec.closed).toHaveLength(5)

  // Shown but not placed (a narrow terminal), then opened by /orch panel: the person's now.
  rec.notPlaced = true
  await frame($, 'show', { owner: 'junkd' })
  await orchCmd($, 'panel')
  expect(rec.opened.at(-1)).toBe('orch')
  await frame($, 'hide', { owner: 'junkd' })
  expect(rec.closed).toHaveLength(5)
})

test('$.orch.hide on a pane never opened: no error, nothing closed, and /orch panel still opens it', WITH_FRAME, async ($, on) => {
  const rec = world(on)
  await start($)
  // No owner: the close goes out (a pane opened but not placed is open too); for an id not open the engine leaves
  // it alone. With an owner the pane never had: nothing at all.
  await frame($, 'hide')
  expect(rec.closed).toEqual(['orch'])
  await frame($, 'hide', { owner: 'junkd' })
  expect(rec.closed).toEqual(['orch'])
  expect(rec.opened).toEqual([])
  await orchCmd($, 'panel')
  expect(rec.opened).toEqual(['orch'])
})

// Every word drawn: the Texts and the Buttons' labels (a field's title is its hotkey Button).
const texts = async (ui: Mounted<Surface, 'Pane'>) =>
  [...(await ui.findAll({ type: 'Text' })).map(t => t.text), ...(await ui.findAll({ type: 'Button' })).map(b => String(b.props.label ?? ''))].join('\n')
async function hotkey(ui: Mounted<Surface, 'Pane'>, key: string) {
  const b = (await ui.findAll({ type: 'Button' })).find(x => x.props.hotkey === key)
  expect(b?.key, `a Button with hotkey ${key}`).toBeDefined()
  await ui.press({ key: b!.key! })
}

test('the pane: six rows; a letter flips a switch, enter in a field saves it, the choice row picks the guard, tab is a hint', WITH_FRAME, async ($, on) => {
  const rec = world(on)
  await start($)
  await orchCmd($, 'panel')
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'orch', surface, ...PANE })
    const t = await texts(ui)
    for (const title of ['Main-loop guard', 'Allow Fable subagents', 'Implementer context cap (k tokens)', 'UI review', 'Inject orchestrator rules', 'Fix rounds'])
      expect(t, title).toContain(title)
    expect(t).toContain('tab')
    expect(t).toContain('enter')
    // letters: a allow_fable_agents, b implementer_ctx_k, c ui_review, d inject_rules, e rounds
    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons.filter(b => /^[a-e]$/.test(String(b.props.hotkey ?? ''))).map(b => b.key).sort()).toEqual(
      ['orch:allow_fable_agents', 'orch:implementer_ctx_k-focus', 'orch:inject_rules', 'orch:rounds-focus', 'orch:ui_review'],
    )
    const before = rec.config.length
    await hotkey(ui, 'a')
    expect(rec.config.at(-1)).toEqual({ key: 'orch.allow_fable_agents', value: true })
    expect(await frame($, 'get', { key: 'allow_fable_agents' })).toBe(true)
    await hotkey(ui, 'a')
    expect(rec.config.at(-1)).toEqual({ key: 'orch.allow_fable_agents', value: false })
    await hotkey(ui, 'c')
    expect(rec.config.at(-1)).toEqual({ key: 'orch.ui_review', value: false })
    expect(await frame($, 'get', { key: 'ui_review' })).toBe(false)
    await hotkey(ui, 'c')
    expect(rec.config.at(-1)).toEqual({ key: 'orch.ui_review', value: true })
    await hotkey(ui, 'd')
    expect(rec.config.at(-1)).toEqual({ key: 'orch.inject_rules', value: false })
    await frame($, 'get', { key: 'inject_rules' }) // a round trip: the press settles before the flag file's write does
    expect(`${CFG}/orch/rules-off` in rec.files).toBe(true)
    await hotkey(ui, 'd')
    await frame($, 'get', { key: 'inject_rules' })
    expect(`${CFG}/orch/rules-off` in rec.files).toBe(false)
    // b and e ask the focus ring onto the number fields; the kit implements no $.ui.focus (no hook of the test's or
    // of another plugin's is reached), so only that the press settles and the pane stays is checked here
    await hotkey(ui, 'b')
    await hotkey(ui, 'e')
    expect(await ui.find({ key: 'orch:rounds-focus' })).toBeDefined()
    // the choice row: the other options are Buttons, the current one is text
    expect((await ui.find({ key: 'orch:guard=fable' }))?.type).toBe('Box')
    expect(await ui.find({ type: 'Button', key: 'orch:guard=fable' })).toBeUndefined()
    await ui.press({ key: 'orch:guard=always' })
    expect(rec.config.at(-1)).toEqual({ key: 'orch.guard', value: 'always' })
    expect(await frame($, 'get', { key: 'guard' })).toBe('always')
    await ui.press({ key: 'orch:guard=fable' })
    expect(rec.config.at(-1)).toEqual({ key: 'orch.guard', value: 'fable' })
    // enter in a number field saves a whole number in range; out of range or not a number: a note, no write
    const field = (await ui.findAll({ type: 'Input' })).find(i => /^orch:rounds/.test(i.key ?? ''))
    expect(field?.key, 'the rounds Input').toBeDefined()
    await ui.input({ key: field!.key!, text: '5' })
    expect(rec.config.at(-1)).toEqual({ key: 'orch.rounds', value: 5 })
    expect(await frame($, 'get', { key: 'rounds' })).toBe(5)
    const writes = rec.config.length
    for (const text of ['11', '0', '2.5', 'x', '']) {
      const f = (await ui.findAll({ type: 'Input' })).find(i => /^orch:rounds/.test(i.key ?? ''))
      await ui.input({ key: f!.key!, text })
      expect(await texts(ui), text).toMatch(/rounds takes a whole number 1–10/)
    }
    expect(rec.config.length).toBe(writes)
    const ctx = (await ui.findAll({ type: 'Input' })).find(i => /^orch:implementer_ctx_k/.test(i.key ?? ''))
    await ui.input({ key: ctx!.key!, text: '1000' })
    expect(rec.config.at(-1)).toEqual({ key: 'orch.implementer_ctx_k', value: 1000 })
    await ui.input({ key: (await ui.findAll({ type: 'Input' })).find(i => /^orch:implementer_ctx_k/.test(i.key ?? ''))!.key!, text: '1001' })
    expect(rec.config.at(-1)).toEqual({ key: 'orch.implementer_ctx_k', value: 1000 })
    expect(rec.config.length).toBeGreaterThan(before)
    await ui.unmount()
  }
  // a mobile surface gets the engine's own drawing, not the pane
  const mobile = await $.ui.mount({ plugin: 'orch', surface: 'mobile', ...PANE })
  expect(await mobile.find({ key: 'engine' })).toBeDefined()
  expect(await mobile.find({ type: 'Button', key: 'close' })).toBeUndefined()
  await mobile.unmount()
})
