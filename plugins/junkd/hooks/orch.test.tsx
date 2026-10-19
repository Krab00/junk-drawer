// junkd's orch feature: the main-loop guard (orch-lib's orchGuard and orchSpawn, pure) and its wiring in orch.tsx
// and index.tsx (the live model, the SendMessage target from the agent list or the SubagentStop record, the placed
// path, the enabled gate), the settings pane, the orch rows of `$.junkd` and the flag files. Everything beneath the
// plugin is answered from memory by `world`; nothing touches a real home. The whole junkd module loads in each test,
// so the world answers every feature's session start too; handoff stays disarmed (its defaults).
import { expect, test } from 'claude-code/testing'
import type { Engine, Mounted, Plugin } from 'claude-code/testing'
import type { Args, On } from 'claude-code'
import { O, SCHEMA, applyOrchSettings, coerce, guardActive, orchGuard, orchSpawn, transcriptTokens, type OrchState, type OrchValues } from './orch-lib'
import { orchCatchDeny } from './orch'
import { rowsOf } from './settings'

const CFG = '/fake/claude'
const FABLE = 'claude-fable-5-1'
const OPUS = 'claude-opus-5-5'
const BIN = '/p/bin/'
const on_: OrchValues = { enabled: true, guard: 'fable', allow_fable_agents: false, implementer_ctx_k: 400, ui_review: true, inject_rules: true, rounds: 3 }
const main = (tool: string, args: Record<string, unknown> = {}) => ({ tool, ...args })
const REPO = '/repo'
const st = (s: Partial<OrchState> = {}): OrchState => ({ model: FABLE, binDir: BIN, configDir: CFG, repo: REPO, ...s })
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
  const kit = (file_path: string) => orchGuard(main('Write', { file_path, content: 'x' }), st({ exists: false, binDir: '/kit/plugins/junkd/bin/' }), on_)
  for (const p of ['/kit/agents/pwn.md', '/kit/skills/x/notes.md', '/kit/docs/commands/x.md', '/kit/plugins/junkd/notes.md'])
    expect(kit(p), p).toMatch(/may Write only/)
  expect(kit('/kit/docs/design.md')).toBeUndefined()
  expect(kit('/repo/docs/hooks/x.md')).toBeUndefined() // outside any plugins/ path or the marketplace
})

test("Write: never the module's own control files junkd/orch-off and junkd/orch-rules-off (the enabled and inject_rules flags), any spelling", () => {
  const write = (file_path: string, extra: Partial<OrchState> = {}) =>
    orchGuard(main('Write', { file_path, content: '' }), st({ exists: false, ...extra }), on_)
  for (const name of ['orch-off', 'orch-rules-off']) {
    const Name = name.replace(/(^|-)(\w)/g, (_m, a: string, b: string) => a + b.toUpperCase()) // Orch-Rules-Off
    // in the config dir: the file, and any path under that name (a directory there would read as the flag)
    for (const p of [`${CFG}/junkd/${name}`, `${CFG}/junkd//${name}`, `${CFG}/junkd/./${name}`, `${CFG}/Junkd/${Name}`, `${CFG}/x/../junkd/${name}`,
      `${CFG}/junkd/${name}/x.md`, `${CFG}/junkd/${Name}/x.md`, `${CFG}/junkd/${name}/a/b.md`, `${CFG}/junkd/${name}//x.md`])
      expect(write(p), p).toMatch(/may Write only/)
    // under any junkd/ dir, outside the config dir: only the deny list stands between a new .md and the flag's name
    for (const p of [`/repo/junkd/${name}/x.md`, `/repo/Junkd/${Name}/x.md`, `/repo/junkd//${name}/x.md`, `/repo/junkd/./${name}/a/b.md`])
      expect(write(p), p).toMatch(/may Write only/)
    // a link that lands on it
    expect(write(`${SCRATCH}/flag.md`, { placed: { path: `/repo/junkd/${name}/x.md`, configDir: CFG, binDir: BIN, repo: REPO } }), name).toMatch(/may Write only/)
    // a name that only starts or ends like it is no flag: a new .md there passes
    for (const p of [`/repo/junkd/${name}.md`, `/repo/junkd/${name}x/a.md`, `/repo/xjunkd/${name}/a.md`, `/repo/junkd/x${name}/a.md`, `/repo/junkd/x/${name}.md`])
      expect(write(p), p).toBeUndefined()
  }
  expect(write('/repo/junkd/orch-x-off/a.md')).toBeUndefined() // neither name
  // the old flag's place is the orch state dir like any of its files now
  expect(write(`${CFG}/orch/rules-off`)).toBeUndefined()
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
  const at = (path: string, configDir = CFG, binDir = BIN, repo = REPO) => ({ placed: { path, configDir, binDir, repo } })
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

test("Read and Write: the repo's .orch/ task store (Read all of it; Write a .md, never the existing config); nothing beside it or above it", () => {
  const guard = (tool: string, file_path: string, extra: Partial<OrchState> = {}) =>
    orchGuard(main(tool, { file_path, content: 'x' }), st({ exists: true, ...extra }), on_)
  for (const p of [`${REPO}/.orch/config.md`, `${REPO}/.orch/tasks/T-1.md`, `${REPO}/.orch/tasks/_lessons.md`, `${REPO}/.orch/tasks/T-1.evidence/ac1.png`,
    `${REPO}//.orch/./tasks/T-1.md`, `${REPO}/.orch/tasks/T-1.ts`]) expect(guard('Read', p), `Read ${p}`).toBeUndefined()
  // Write in the store: an existing .md (task file, lessons, a policy note), any case of the extension
  for (const p of [`${REPO}/.orch/tasks/T-1.md`, `${REPO}/.orch/tasks/_lessons.md`, `${REPO}//.orch/./tasks/T-1.md`, `${REPO}/.orch/TEST-POLICY.md`,
    `${REPO}/.orch/tasks/T-1.MD`, `${REPO}/.orch/tasks/config.md`, `${REPO}/.orch/config.md.md`, `${REPO}/.orch/x/config.md`])
    expect(guard('Write', p), `Write ${p}`).toBeUndefined()
  // ...but not an existing config (its tasks_dir steers the bin scripts) in any spelling, nor a file that is no .md
  for (const p of [`${REPO}/.orch/config.md`, `${REPO}/.orch/CONFIG.MD`, `${REPO}//.orch/./config.md`, `${REPO}/.orch/tasks/../config.md`,
    `${REPO}/.orch/tasks/T-1.evidence/ac1.png`, `${REPO}/.orch/tasks/T-1.ts`, `${REPO}/.orch/tasks/T-1.md.sh`, `${REPO}/.orch/md`])
    expect(guard('Write', p), `Write ${p}`).toMatch(/may Write only/)
  // a config that does not exist yet is a new .md like any other (orch-init's first write)
  expect(guard('Write', `${REPO}/.orch/config.md`, { exists: false })).toBeUndefined()
  // a link inside the store that lands on the config is refused where it lands
  expect(guard('Write', `${REPO}/.orch/tasks/T-9.md`, { placed: { path: `${REPO}/.orch/config.md`, configDir: CFG, binDir: BIN, repo: REPO } })).toMatch(/may Write only/)
  // a .. out of the store, another repo's store, a sibling whose name starts with .orch or ends with it, the dir itself
  for (const p of [`${REPO}/.orch/../src/a.ts`, `${REPO}/.orch/tasks/../../src/a.ts`, '/other/.orch/x.ts', `${REPO}/.orchard/x.ts`,
    `${REPO}/x.orch/a.ts`, `${REPO}/src/.orch/a.ts`, `${REPO}/.orch`, '/repo2/.orch/a.ts', '/.orch/a.ts']) {
    expect(guard('Read', p), p).toMatch(/may not run Read/)
    expect(guard('Write', p), p).toMatch(/may Write only/)
  }
  // an existing .md elsewhere is no new file: the store is the only reason it would pass
  for (const p of ['/other/.orch/x.md', `${REPO}/.orchard/x.md`]) expect(guard('Write', p), p).toMatch(/may Write only/)
  // no repo: no store, and '' never makes `/.orch/` one
  for (const p of [`${REPO}/.orch/config.md`, '/.orch/config.md']) {
    expect(guard('Read', p, { repo: '' }), p).toMatch(/may not run Read/)
    expect(guard('Write', p, { repo: '' }), p).toMatch(/may Write only/)
  }
  // the deny lists still hold inside the store
  for (const p of [`${REPO}/.orch/CLAUDE.md`, `${REPO}/.orch/SKILL.md`, `${REPO}/.orch/.claude-plugin/x.json`, `${REPO}/.orch/x/../../src/a.ts`])
    expect(guard('Write', p), p).toMatch(/may Write only/)
  // where it lands decides too: a link out of the store is refused; the repo resolved alike passes
  const at = (path: string, repo = REPO) => ({ placed: { path, configDir: CFG, binDir: BIN, repo } })
  expect(guard('Write', `${REPO}/.orch/tasks/T-1.md`, at('/elsewhere/src/a.ts'))).toMatch(/may Write only/)
  expect(guard('Read', `${REPO}/.orch/tasks/T-1.md`, at('/elsewhere/src/a.ts'))).toMatch(/may not run Read/)
  expect(guard('Write', `${REPO}/.orch/tasks/T-1.md`, at('/real/repo/.orch/tasks/T-1.md', '/real/repo'))).toBeUndefined()
  expect(guard('Read', `${REPO}/.orch/config.md`, at('/real/repo/.orch/config.md', '/real/repo'))).toBeUndefined()
})

test('CronCreate and ScheduleWakeup: only /junkd:orch, /loop of an allowed prompt, a plain prompt, or a stop', () => {
  for (const tool of ['CronCreate', 'ScheduleWakeup']) {
    const sched = (args: Record<string, unknown>) => orchGuard(main(tool, args), st(), on_)
    // one assertion per accepted spelling of the skill: namespaced and bare
    for (const prompt of ['/junkd:orch all', '/orch all', '  /junkd:orch T-1 T-2', '/junkd:orch', '/loop 20m /junkd:orch all', '/loop /orch all',
      '/loop', 'check the deploy', 'look at /model docs']) {
      expect(sched({ prompt, cron: '*/20 * * * *', delaySeconds: 1200 }), prompt).toBeUndefined()
    }
    expect(sched({ cron: '*/20 * * * *' })).toBeUndefined()
    expect(sched({ prompt: '/model opus', stop: true })).toBeUndefined()
    // the old plugin's names are no command of junkd's: refused like any other
    for (const prompt of ['/model opus', ' /model opus', '/plugin disable junkd@junk-drawer', '/loop 20m /model opus',
      '/loop /loop 5m /config', '/junkd:orch-init', '/orch:init', '/orch:orch all', '/loop /orch:orch all', '/orchestra', '/orch-init',
      '/junkd:orchestra', '/junkd:handoff', '/xjunkd:orch', '/junkd:junkd:orch', '/handoff auto']) {
      expect(sched({ prompt, cron: '*/20 * * * *' }), prompt).toMatch(/may schedule only \/junkd:orch, \/loop or a plain prompt/)
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

test('Agent: only opus, sonnet or haiku, or a junkd: type without a model; never a fork', () => {
  const agent = (args: Record<string, unknown>) => orchGuard(main('Agent', { prompt: 'p', description: 'd', ...args }), st(), on_)
  expect(agent({ subagent_type: 'fork' })).toMatch(/runs on the main loop's model or a costlier one\. Set model: opus\|sonnet\|haiku/)
  for (const args of [{ subagent_type: 'fork', model: 'sonnet' }, {}, { subagent_type: 'Explore' },
    { subagent_type: 'general-purpose', model: 'fable' }, { model: 'Fable' }, { model: 'inherit' }, { model: ' ' }, { model: '' },
    { subagent_type: 'junkd:implementer', model: 'fable' }, { subagent_type: 'junkd:orch-ops', model: 'inherit' }, { subagent_type: 'orchestra' },
    { subagent_type: 'orch' }, { model: 'opus-plus' },
    // the old plugin's prefix, and names that only look like junkd's, pin no model
    { subagent_type: 'orch:implementer' }, { subagent_type: 'junkd' }, { subagent_type: 'xjunkd:implementer' }, { subagent_type: 'Junkd:implementer' }]) {
    expect(agent(args), JSON.stringify(args)).toMatch(/Set model: opus\|sonnet\|haiku/)
  }
  expect(agent({ model: 'sonnet' })).toBeUndefined()
  expect(agent({ model: 'haiku' })).toBeUndefined()
  expect(agent({ subagent_type: 'general-purpose', model: ' Opus ' })).toBeUndefined()
  expect(agent({ subagent_type: 'junkd:orch-ops' })).toBeUndefined()
  expect(agent({ subagent_type: 'junkd:implementer', model: 'haiku' })).toBeUndefined()
  expect(agent({ model: 'fable' })).toMatch(/needs the user's ask and allow_fable_agents on/)
  // allow_fable_agents (the user asked): an explicit fable or Fable id passes; a fork, inherit or no model still don't
  const allowed = (args: Record<string, unknown>) =>
    orchGuard(main('Agent', { prompt: 'p', description: 'd', ...args }), st(), { ...on_, allow_fable_agents: true })
  for (const args of [{ model: 'fable' }, { model: ' Fable ' }, { subagent_type: 'junkd:implementer', model: FABLE }])
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
  expect(spawn({ subagentType: 'junkd:implementer', model: 'fable' })).toMatch(/would run on fable/)
  expect(spawn({ model: 'opus' })).toBeUndefined()
  expect(spawn({ subagentType: 'junkd:implementer' })).toBeUndefined() // pinned in its frontmatter
  expect(spawn({ subagentType: 'orch:implementer' })).toMatch(/would run on claude-fable-5-1/) // the old prefix: no junkd type
  expect(spawn({ subagentType: 'junkd:implementer', model: 'inherit' })).toMatch(/would run on claude-fable-5-1/) // inherit = the parent's
  expect(spawn({ parentAgentId: 'a1' })).toBeUndefined() // a subagent's own spawn
  expect(spawn({}, { ...on_, guard: 'off' })).toBeUndefined()
  expect(spawn({ parentModel: OPUS })).toBeUndefined() // fable guard, Opus main loop
  expect(spawn({ fork: true, subagentType: 'fork', parentModel: OPUS }, { ...on_, guard: 'always' })).toMatch(/a fork/)
  expect(spawn({ parentModel: OPUS, model: 'fable' }, { ...on_, guard: 'always' })).toMatch(/would run on fable/)
  // allow_fable_agents: a Fable given explicitly passes; the parent's (no model, inherit) or a fork still doesn't
  const allow = { ...on_, allow_fable_agents: true }
  expect(spawn({ model: 'fable' }, allow)).toBeUndefined()
  expect(spawn({ subagentType: 'junkd:implementer', model: FABLE }, allow)).toBeUndefined()
  expect(spawn({}, allow)).toMatch(/would run on claude-fable-5-1/)
  expect(spawn({ model: 'inherit' }, allow)).toMatch(/would run on claude-fable-5-1/)
  expect(spawn({ fork: true, subagentType: 'fork', model: 'fable' }, allow)).toMatch(/a fork/)
})

test('SendMessage: reviewers are always fresh, an implementer over the cap is replaced, an unknown target is refused', () => {
  const send = main('SendMessage', { to: 'a1', message: 'fix' })
  for (const type of ['verify-coordinator', 'junkd:verify-coordinator', 'junkd:ui-reviewer', 'ui-reviewer']) {
    expect(orchGuard(send, st({ agent: { type } }), on_), type).toMatch(/reviewers are always fresh: spawn a new one/)
  }
  expect(orchGuard(send, st({ agent: { type: 'junkd:implementer-x' } }), on_)).toBeUndefined() // no reviewer by its name
  expect(orchGuard(send, st({ agent: { type: 'junkd:ui-reviewer-x' } }), on_)).toBeUndefined()
  // test-planner and test-reviewer are reviewers too, bare and junkd:-prefixed; their names inside another type are not
  for (const type of ['test-planner', 'junkd:test-planner', 'test-reviewer', 'junkd:test-reviewer'])
    expect(orchGuard(send, st({ agent: { type } }), on_), type).toMatch(new RegExp(`^${PREFIX.replace(/[()]/g, '\\$&')} ${type.replace(/^junkd:/, '')} is a reviewer, and reviewers are always fresh`))
  for (const type of ['junkd:implementer', 'implementer', 'junkd:test-reviewer-x', 'test-plannerx', 'xtest-planner', 'junkd:test-runner', 'other:test-reviewer', 'orch:test-reviewer'])
    expect(orchGuard(send, st({ agent: { type } }), on_), type).toBeUndefined()
  expect(orchGuard(send, st({ agent: { type: 'junkd:implementer', tokens: 450_000 } }), on_)).toMatch(
    /implementer context 450k exceeds cap 400k: spawn a fresh implementer, hand it `git diff <base>...<branch>` and why previous rounds failed/,
  )
  // the exact bound: at the cap passes, one token over is refused
  expect(orchGuard(send, st({ agent: { type: 'junkd:implementer', tokens: 400_000 } }), on_)).toBeUndefined()
  expect(orchGuard(send, st({ agent: { type: 'junkd:implementer', tokens: 400_001 } }), on_)).toMatch(/implementer context 400k exceeds cap 400k/)
  expect(orchGuard(send, st({ agent: { type: 'junkd:implementer', tokens: 300_000 } }), on_)).toBeUndefined()
  expect(orchGuard(send, st({ agent: { tokens: 300_000 } }), { ...on_, implementer_ctx_k: 250 })).toMatch(/exceeds cap 250k/)
  expect(orchGuard(send, st({ agent: { type: 'general-purpose' } }), on_)).toBeUndefined()
  expect(orchGuard(send, st({ agent: null }), on_)).toMatch(/no agent "a1" is known/)
})

test('settings: defaults for missing or wrong types, the number rows clamped to their bounds at load', () => {
  applyOrchSettings({})
  expect({ ...O }).toEqual({ enabled: true, guard: 'fable', allow_fable_agents: false, implementer_ctx_k: 400, ui_review: true, inject_rules: true, rounds: 3 })
  applyOrchSettings({ enabled: false, guard: 'always', implementer_ctx_k: 5000, allow_fable_agents: true, ui_review: false, inject_rules: false, rounds: 99 })
  expect({ ...O }).toEqual({ enabled: false, guard: 'always', allow_fable_agents: true, implementer_ctx_k: 1000, ui_review: false, inject_rules: false, rounds: 10 })
  applyOrchSettings({ enabled: 'yes', guard: 'sometimes', implementer_ctx_k: 10.4, allow_fable_agents: 'yes', ui_review: 'no', inject_rules: 1, rounds: 0 })
  expect({ ...O }).toEqual({ enabled: false, guard: 'fable', allow_fable_agents: false, implementer_ctx_k: 50, ui_review: false, inject_rules: false, rounds: 1 })
  // enabled at load, one assertion per value: only a JSON true or nothing is on
  for (const [v, want] of [[true, true], [undefined, true], [false, false], ['true', false], [1, false], [null, false]] as const) {
    applyOrchSettings(v === undefined ? {} : { enabled: v })
    expect(O.enabled, String(v)).toBe(want)
  }
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
  for (const v of [true, 'true', 'on']) expect(coerce('enabled', v).value, String(v)).toBe(true)
  for (const v of [false, 'false', 'off', 'yes', 1, '']) expect(coerce('enabled', v).value, String(v)).toBe(false)
})

test("SCHEMA is settings.ts's orch rows, by field and in manifest order: enabled first, the guard the one choice row", () => {
  expect(SCHEMA.map(f => f.key)).toEqual(['enabled', 'guard', 'allow_fable_agents', 'implementer_ctx_k', 'ui_review', 'inject_rules', 'rounds'])
  expect(SCHEMA.map(f => ({ ...f, key: `orch_${f.key}` }))).toEqual(rowsOf('orch').map(({ group: _g, field: _f, ...f }) => f))
  expect(SCHEMA.filter(f => f.options).map(f => [f.key, f.options])).toEqual([['guard', ['fable', 'always', 'off']]])
})

test('enabled off: the guard holds nothing, whatever guard says; no spawn is refused; the .catch lets every call through', () => {
  const off: OrchValues = { ...on_, enabled: false }
  for (const guard of ['fable', 'always'] as const) {
    const o = { ...off, guard }
    expect(guardActive(FABLE, o), guard).toBe(false)
    expect(guardActive(OPUS, o), guard).toBe(false)
    expect(guardActive(FABLE, { ...o, enabled: true }), `${guard} on`).toBe(true) // the same rows, enabled: held
    for (const [tool, args] of [['Edit', {}], ['Bash', { command: 'git push' }], ['Read', { file_path: '/repo/src/a.ts' }],
      ['Write', { file_path: '/repo/src/a.ts' }], ['Agent', { subagent_type: 'fork' }], ['SendMessage', { to: 'x' }], ['CronCreate', { prompt: '/model opus' }]] as const)
      expect(orchGuard(main(tool, args), st({ exists: true, agent: null }), o), `${guard} ${tool}`).toBeUndefined()
    expect(orchSpawn({ fork: true, subagentType: 'fork', parentModel: FABLE }, o), guard).toBeUndefined()
    expect(orchSpawn({ fork: false, subagentType: 'general-purpose', parentModel: FABLE, model: 'fable' }, o), guard).toBeUndefined()
  }
  // orchCatchDeny reads the live settings (O): held only while enabled and guard is not off, and never for a subagent
  try {
    for (const [opts, agentId, want] of [
      [{}, undefined, true], [{ guard: 'always' }, undefined, true], [{}, 'a1', false], [{ guard: 'off' }, undefined, false],
      [{ enabled: false }, undefined, false], [{ enabled: false, guard: 'always' }, undefined, false], [{ enabled: true }, undefined, true],
    ] as const) {
      applyOrchSettings(opts)
      const deny = orchCatchDeny(agentId)
      expect(deny, `${JSON.stringify(opts)} ${agentId}`).toBe(want ? `${PREFIX} guard error` : undefined)
    }
  } finally {
    applyOrchSettings({})
  }
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
    orchGuard(main('SendMessage', { to: 'x' }), st({ agent: { type: 'junkd:implementer', tokens: 900_000 } }), on_),
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
// The plugin's root as the module sees it ($.plugin.root): this file's folder is its hooks/.
const ROOT = String((import.meta as unknown as { dir: string }).dir).replace(/\/hooks\/?$/, '')
const OFF_FLAG = `${CFG}/junkd/orch-off`
const RULES_FLAG = `${CFG}/junkd/orch-rules-off`

function world(on: On) {
  const env: Record<string, string> = { HOME: '/home/u', CLAUDE_CONFIG_DIR: CFG }
  const files: Record<string, string> = {}
  const store: Record<string, unknown> = {}
  const rec = { model: FABLE as string | undefined, agents: [] as Agent[], files, toasts: [] as string[],
    links: {} as Record<string, string>, dangling: {} as Record<string, string[]>, nowhere: [] as string[], envFails: false,
    config: [] as { key: string; value: unknown }[], opened: [] as string[], focus: [] as (true | undefined)[], closed: [] as string[], runs: [] as string[][],
    existsFails: false, writeFails: false, notPlaced: false, dirs: [] as string[], // dirs: folders that exist (fs.exists true, stat kind dir)
    cwd: '/tmp' as string, cwdFails: false, git: {} as Record<string, string>, gitFails: [] as string[] } // git: a cwd's `rev-parse --show-toplevel`; any other cwd is in no repo; gitFails: the cwds where it exits 128 with that stdout anyway
  on('env.get', (_$, e) => {
    if (rec.envFails) throw new Error('env unavailable')
    return { value: env[e.name] }
  })
  // A listed file, or a folder (a last name with no extension) outside /missing; realPath through `links` (applied
  // in order, so a chain of links resolves), and a link into /missing leads nowhere (stat follows it). `dangling`
  // names links to nothing per folder, as fs.list (an lstat) shows them.
  on('fs.stat', (_$, e) => {
    const p = e.path.length > 1 ? e.path.replace(/\/$/, '') : e.path
    if (rec.nowhere.includes(p)) return { value: { kind: 'other' as const, size: 0, mtimeMs: 0, isLink: true } } // the engine's own shape
    const isFile = p in files && !rec.dirs.includes(p)
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
  on('session.cwd', () => {
    if (rec.cwdFails) throw new Error('no cwd')
    return { value: rec.cwd }
  })
  // What the other features' starts and the /junkd set touch: no pane up, the bare /junkd registered, the handoff
  // loop's saved state (none: disarmed), no command listed.
  on('ui.panes', () => ({ value: [] }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({ value: [] }))
  on('store.get', (_$, e) => ({ value: store[e.key] }))
  on('store.set', (_$, e) => { store[e.key] = e.value; return { value: undefined } })
  on('ui.toast', (_$, e) => { rec.toasts.push(e.text); return { value: undefined } })
  on('ui.open', (_$, e) => { rec.opened.push(e.id); rec.focus.push(e.focus); return { value: rec.notPlaced ? { isPlaced: false as const, reason: 'no room' } : { isPlaced: true as const } } })
  on('ui.close', (_$, e) => { rec.closed.push(e.id); return { value: undefined } })
  on('ui.focus', () => ({}))
  on('config.set', (_$, e) => { rec.config.push({ key: e.key, value: e.value }); return { value: e.value } })
  on('agent.list', () => ({ value: rec.agents.map(a => ({ description: '', status: 'completed' as const, ...a })) }))
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  on('fs.exists', (_$, e) => {
    if (rec.existsFails) throw new Error('EACCES')
    return { value: e.path in files || rec.dirs.includes(e.path) }
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
    if (e.argv[0] === 'git') {
      const top = rec.git[e.argv[2]!]
      const failed = top === undefined || rec.gitFails.includes(e.argv[2]!)
      return { value: { exitCode: failed ? 128 : 0, stdout: top === undefined ? '' : `${top}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('classic.SubagentStop', () => ({}))
  // The engine's own drawing where the mod passes.
  on('ui.render', ($, e) => $.ui.resolve(e).Box({ key: 'engine' }))
  return rec
}

const start = ($: Engine) => $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
const run = ($: Engine, command: string, args: string) =>
  $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
const orchCmd = ($: Engine, args: string) => run($, 'junkd:orch', args)
const junkdCmd = ($: Engine) => run($, 'junkd', '') // the /junkd set: junkd, handoff and orch as tabs
// What a denied call carries: `deny` for a plugin's call, the errored `text` for the engine's.
const denial = (r: unknown) => {
  const o = r as { deny?: string; isError?: boolean; text?: string }
  return o.deny ?? (o.isError ? o.text : undefined)
}
const edit = ($: Engine) => $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' })
const fetch = ($: Engine) => $.tool.call({ tool: 'WebFetch', url: 'https://x', prompt: 'p' })
const spawnOf = ($: Engine) => (e: Partial<Args<'agent.spawn'>>) => $.agent.spawn({ tool_use_id: 'tu1', prompt: 'p', description: 'd',
  subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' }, parentModel: FABLE, background: true, fork: false, ...e })

// Another plugin beside junkd: `/frame <method> [json]` calls `$.junkd.<method>` (or `$.config.set` for `config`,
// the /config menu's own path) and answers what came back (an inline plugin closes over nothing, so the command
// carries the result out as text).
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
          if (Array.isArray(await $.junkd.schema())) answered.push('schema')
          if (typeof (await $.junkd.get({ key: 'orch_rounds' })) === 'number') answered.push('get')
          if (typeof (await $.junkd.set({ key: 'orch_rounds', value: await $.junkd.get({ key: 'orch_rounds' }) })) === 'number') answered.push('set')
          await $.junkd.open({ pane: 'orch' })
          await $.junkd.open({ pane: 'orch' })
          answered.push('open')
          if (typeof (await $.junkd.orchGuardState()).active === 'boolean') answered.push('orchGuardState')
          return { text: JSON.stringify({ ok: answered }) }
        }
        if (method === 'schema') return { text: JSON.stringify({ ok: await $.junkd.schema() }) }
        if (method === 'get') return { text: JSON.stringify({ ok: await $.junkd.get(input) }) }
        if (method === 'set') return { text: JSON.stringify({ ok: await $.junkd.set(input) }) }
        if (method === 'open') return { text: JSON.stringify({ ok: await $.junkd.open(input ?? { pane: 'orch' }) }) }
        if (method === 'guardState') return { text: JSON.stringify({ ok: await $.junkd.orchGuardState() }) }
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
  const r = (await run($, 'frame', args)) as { text?: string }
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

  await frame($, 'set', { key: 'orch_guard', value: 'always' })
  rec.model = OPUS
  expect(denial(await fetch($))).toMatch(/may not run WebFetch/)
  expect(await frame($, 'guardState')).toEqual({ active: true, model: OPUS })
  await frame($, 'set', { key: 'orch_guard', value: 'off' })
  expect(denial(await fetch($))).toBeUndefined()
  rec.model = FABLE
  expect(denial(await fetch($))).toBeUndefined()
  expect(denial(await edit($))).toBeUndefined()
  expect(await frame($, 'guardState')).toEqual({ active: false, model: FABLE })
  await frame($, 'set', { key: 'orch_guard', value: 'fable' })
  expect(denial(await fetch($))).toMatch(/may not run WebFetch/)
})

test("the task store: the session cwd's git toplevel is the repo whose .orch/ the main loop reads and writes; cached per cwd", async ($, on) => {
  const rec = world(on)
  await start($)
  const read = (file_path: string) => $.tool.call({ tool: 'Read', file_path })
  const write = (file_path: string) => $.tool.call({ tool: 'Write', file_path, content: 'x' })
  const gitRuns = () => rec.runs.filter(r => r[0] === 'git')
  rec.files['/work/app/.orch/config.md'] = '---\n---\n'
  rec.files['/work/app/.orch/tasks/T-1.ts'] = 'x'
  // in no repo (git fails): no store
  rec.cwd = '/work/none'
  expect(denial(await read('/work/app/.orch/config.md'))).toMatch(/may not run Read/)
  expect(gitRuns()).toEqual([['git', '-C', '/work/none', 'rev-parse', '--show-toplevel']])
  // a cwd inside the repo: its toplevel's .orch/ passes, both spellings
  rec.cwd = '/work/app/src'
  rec.git['/work/app/src'] = '/work/app'
  expect(denial(await read('/work/app/.orch/config.md'))).toBeUndefined()
  rec.files['/work/app/.orch/tasks/T-1.md'] = '---\n---\n'
  expect(denial(await write('/work/app/.orch/tasks/T-1.md'))).toBeUndefined() // an existing .md: only the store lets it
  expect(denial(await write('/work/app/.orch/tasks/T-1.ts'))).toMatch(/may Write only/) // the store takes .md only
  expect(denial(await write('/work/app/.orch/config.md'))).toMatch(/may Write only/) // nor the existing config
  expect(denial(await read('/work/app/.orchard/config.md'))).toMatch(/may not run Read/)
  expect(denial(await read('/work/app/.orch/../src/a.ts'))).toMatch(/may not run Read/)
  expect(denial(await read('/work/other/.orch/config.md'))).toMatch(/may not run Read/)
  expect(gitRuns().length).toBe(2) // once per cwd, not per call
  // the repo is resolved like the path: a linked repo dir passes when both land inside it
  rec.links['/work/app'] = '/real/app'
  expect(denial(await read('/work/app/.orch/config.md'))).toBeUndefined()
  // the cwd moved (a /cd): asked again
  rec.cwd = '/work/none'
  expect(denial(await read('/work/app/.orch/config.md'))).toMatch(/may not run Read/)
  expect(gitRuns().length).toBe(2) // /work/none is cached as no repo
  // a git that fails is no repo, whatever it printed
  rec.cwd = '/work/broken'
  rec.git['/work/broken'] = '/work/app'
  rec.gitFails.push('/work/broken')
  expect(denial(await read('/work/app/.orch/config.md'))).toMatch(/may not run Read/)
})

test('the task store: no cwd (empty, or session.cwd failing) is no repo, and git is never asked about it', async ($, on) => {
  const rec = world(on)
  await start($)
  rec.files['/work/app/.orch/config.md'] = '---\n---\n'
  rec.git[''] = '/work/app' // what a `git -C ''` (git's own cwd) would answer
  const read = () => $.tool.call({ tool: 'Read', file_path: '/work/app/.orch/config.md' })
  const gitRuns = () => rec.runs.filter(r => r[0] === 'git')
  rec.cwd = ''
  expect(denial(await read())).toMatch(/may not run Read/)
  expect(gitRuns()).toEqual([])
  rec.cwd = '/work/app'
  rec.cwdFails = true
  expect(denial(await read())).toMatch(/may not run Read/)
  expect(gitRuns()).toEqual([])
})

test("AC8: another plugin's $.tool.call and $.agent.spawn pass on a guarded Fable main loop; the engine's own are denied", WITH_FRAME, async ($, on) => {
  world(on)
  on('agent.spawn', (_$, e) => ({ model: e.model ?? 'opus', agentId: 'sub-1' }))
  await start($)
  expect(denial(await edit($))).toMatch(/may not run Edit/)
  expect(denial(await frame($, 'edit'))).toBeUndefined()
  expect(denial(await frame($, 'bash'))).toBeUndefined()
  expect((await frame($, 'spawn') as { deny?: string }).deny).toBeUndefined() // a Fable model the guard would refuse the model's own spawn
  expect((await spawnOf($)({ subagentType: 'fork', fork: true })).deny).toMatch(/a fork/)
})

test("AC8: with guard always, another plugin's spawn of a Fable model passes where the model's own is refused", { ...WITH_FRAME, options: { orch_guard: 'always' } }, async ($, on) => {
  world(on)
  on('agent.spawn', (_$, e) => ({ model: e.model ?? 'opus', agentId: 'sub-1' }))
  await start($)
  expect((await spawnOf($)({ parentModel: OPUS, model: 'fable' })).deny).toMatch(/would run on fable/)
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
  rec.agents = [{ id: 'imp1', type: 'junkd:implementer', name: 'impl' }]
  rec.files['/t/imp1.jsonl'] = `${JSON.stringify({ message: { usage: { input_tokens: 500_000 } } })}\n`
  await $.classic.SubagentStop({ agent_id: 'imp1', agent_type: 'junkd:implementer', agent_transcript_path: '/t/imp1.jsonl', stop_hook_active: false })
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

test('a session start whose flag writes fail still starts', { options: { orch_inject_rules: false, orch_enabled: false } }, async ($, on) => {
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

test('the guard option the engine fills in from the manifest holds at load', { ...WITH_FRAME, options: { orch_guard: 'always' } }, async ($, on) => {
  const rec = world(on)
  rec.model = OPUS
  await start($)
  expect(denial(await edit($))).toMatch(/may not run Edit/)
  expect(await frame($, 'get', { key: 'orch_guard' })).toBe('always')
})

test('SendMessage target from the agent list or the SubagentStop record (type and transcript tokens)', { ...WITH_FRAME, options: { orch_implementer_ctx_k: 300 } }, async ($, on) => {
  const rec = world(on)
  await start($)
  const send = (to: string) => $.tool.call({ tool: 'SendMessage', to, message: 'fix the failing criteria' })
  rec.agents = [{ id: 'rev1', type: 'junkd:verify-coordinator' }, { id: 'imp1', type: 'junkd:implementer', name: 'impl' }, { id: 'ui1', type: 'ui-reviewer' }]
  expect(denial(await send('rev1'))).toMatch(/verify-coordinator is a reviewer, and reviewers are always fresh/)
  expect(denial(await send('ui1'))).toMatch(/ui-reviewer is a reviewer/)
  expect(denial(await send('imp1'))).toBeUndefined() // no record yet: tokens unknown
  const usage = (n: number) => `${JSON.stringify({ message: { usage: { input_tokens: n } } })}\n`
  rec.files['/t/imp1.jsonl'] = usage(320_000)
  await $.classic.SubagentStop({ agent_id: 'imp1', agent_type: 'junkd:implementer', agent_transcript_path: '/t/imp1.jsonl', stop_hook_active: false })
  expect(denial(await send('impl'))).toMatch(/implementer context 320k exceeds cap 300k/) // by name
  expect(denial(await send('imp1'))).toMatch(/exceeds cap 300k/) // by id
  expect(denial(await send('rev1 [123]'))).toMatch(/reviewers are always fresh/) // ListAgents' " [ref]" dropped
  rec.files['/t/gone.jsonl'] = usage(1000)
  await $.classic.SubagentStop({ agent_id: 'gone', agent_type: 'junkd:ui-reviewer', agent_transcript_path: '/t/gone.jsonl', stop_hook_active: false })
  expect(denial(await send('gone'))).toMatch(/reviewers are always fresh/) // not in the list: the record answers
  rec.files['/t/fixer.jsonl'] = usage(350_000)
  await $.classic.SubagentStop({ agent_id: 'fixer', agent_type: 'junkd:implementer', agent_transcript_path: '/t/fixer.jsonl', stop_hook_active: false })
  expect(denial(await send('fixer'))).toMatch(/exceeds cap 300k/)
  rec.files['/t/small.jsonl'] = usage(300_000) // at the cap: passes
  await $.classic.SubagentStop({ agent_id: 'small', agent_type: 'junkd:implementer', agent_transcript_path: '/t/small.jsonl', stop_hook_active: false })
  expect(denial(await send('small'))).toBeUndefined()
  await $.classic.SubagentStop({ agent_id: 'noread', agent_type: 'junkd:implementer', agent_transcript_path: '/t/none.jsonl', stop_hook_active: false })
  expect(denial(await send('noread'))).toBeUndefined() // an unreadable transcript: tokens unknown, the type known
  // an agent that stopped before the list named it: its record is by id, the list's name leads to it
  rec.files['/t/late.jsonl'] = usage(330_000)
  await $.classic.SubagentStop({ agent_id: 'late', agent_type: 'junkd:implementer', agent_transcript_path: '/t/late.jsonl', stop_hook_active: false })
  rec.agents.push({ id: 'late', type: 'junkd:implementer', name: 'latename' })
  expect(denial(await send('latename'))).toMatch(/exceeds cap 300k/)
  expect(denial(await send('nobody'))).toMatch(/no agent "nobody" is known/)
  expect(denial(await send('../../x'))).toMatch(/no agent/) // never read as a path
  await frame($, 'set', { key: 'orch_implementer_ctx_k', value: 400 })
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

test('guard always needs no model: an unreadable one still denies and nothing is toasted', { options: { orch_guard: 'always' } }, async ($, on) => {
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

test("bin/ through its link chain: a script runs from the main loop by the plugin root's bin/ path; a write into bin/, by any spelling or link, is refused", async ($, on) => {
  const rec = world(on)
  // plugins/junkd/bin -> skills/junkd/bin, whose entries link to ../../orch/bin/<x> (the real scripts)
  rec.links[`${ROOT}/bin`] = `${ROOT}/skills/junkd/bin`
  for (const s of ['orch-state', 'orch-sync', 'orch-worktree']) {
    rec.links[`${ROOT}/skills/junkd/bin/${s}`] = `${ROOT}/skills/orch/bin/${s}`
    rec.files[`${ROOT}/skills/orch/bin/${s}`] = '#!/usr/bin/env bash\n'
  }
  await start($)
  const bash = (command: string) => $.tool.call({ tool: 'Bash', command })
  for (const c of [`${ROOT}/bin/orch-state list`, `"${ROOT}/bin/orch-state" settings`, `${ROOT}/bin/orch-sync pull`, `${ROOT}/bin/orch-worktree add T-1 task/T-1-x main`])
    expect(denial(await bash(c)), c).toBeUndefined()
  // the real files the links lead to are no bin/ path: only the plugin root's bin/ is
  for (const c of [`${ROOT}/skills/orch/bin/orch-state list`, `${ROOT}/skills/junkd/bin/orch-state list`, `${ROOT}/bin/../skills/orch/bin/orch-state`, `git -C ${ROOT}/bin status`])
    expect(denial(await bash(c)), c).toMatch(/may not run Bash \(only the junkd plugin's own bin\/ scripts/)
  const write = (file_path: string) => $.tool.call({ tool: 'Write', file_path, content: '# x' })
  for (const p of [`${ROOT}/bin/orch-state`, `${ROOT}/bin/new.md`, `${ROOT}/skills/junkd/bin/orch-sync`, `${ROOT}/skills/orch/bin/orch-state`, `${ROOT}/skills/orch/bin/new.md`])
    expect(denial(await write(p)), p).toMatch(/may Write only/)
  // a link from elsewhere into bin/ is refused where it lands
  rec.links['/repo/tools'] = `${ROOT}/bin`
  expect(denial(await write('/repo/tools/orch-state'))).toMatch(/may Write only/)
  expect(denial(await write('/repo/tools/new.md'))).toMatch(/may Write only/)
  expect(denial(await write('/repo/docs/new.md'))).toBeUndefined() // a new .md elsewhere still passes
})

test('a guard hook that throws refuses on a guarded main loop, and passes with the guard off, orch disabled or in a subagent', WITH_FRAME, async ($, on) => {
  const rec = world(on)
  await start($)
  rec.envFails = true // the config dir can't be read: orchCheck throws
  expect(denial(await $.tool.call({ tool: 'Read', file_path: `${SCRATCH}/r.md` }))).toMatch(/^Orchestrator mode \(orch\): guard error$/)
  const sub = { tool: 'Read', agentId: 'a1', file_path: '/repo/a.ts' } as unknown as Parameters<Engine['tool']['call']>[0]
  expect(denial(await $.tool.call(sub))).toBeUndefined()
  rec.envFails = false
  await frame($, 'set', { key: 'orch_guard', value: 'off' })
  rec.envFails = true
  expect(denial(await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' }))).toBeUndefined()
  rec.envFails = false
  await frame($, 'set', { key: 'orch_guard', value: 'always' })
  await frame($, 'set', { key: 'orch_enabled', value: false })
  rec.envFails = true
  expect(denial(await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' }))).toBeUndefined()
})

test('agent.spawn refuses a fork or a Fable model on the main loop; a subagent\'s spawn passes', async ($, on) => {
  world(on)
  on('agent.spawn', (_$, e) => ({ model: e.model ?? 'opus', agentId: 'sub-1' }))
  await start($)
  const spawn = spawnOf($)
  expect((await spawn({ model: 'fable' })).deny).toMatch(/would run on fable/)
  expect((await spawn({ subagentType: 'junkd:implementer', model: 'fable' })).deny).toMatch(/would run on fable/)
  expect((await spawn({ fork: true, subagentType: 'fork' })).deny).toMatch(/a fork/)
  expect((await spawn({})).deny).toMatch(/would run on claude-fable-5-1/)
  expect(await spawn({ model: 'sonnet' })).toMatchObject({ agentId: 'sub-1' })
  expect(await spawn({ subagentType: 'junkd:implementer' })).toMatchObject({ agentId: 'sub-1' })
  expect((await spawn({ subagentType: 'orch:implementer' })).deny).toMatch(/would run on claude-fable-5-1/) // the old prefix pins nothing
  expect(await spawn({ model: 'fable', parentAgentId: 'a1' })).toMatchObject({ agentId: 'sub-1' })
})

test('agent.spawn whose guard hook throws refuses on a guarded main loop; a subagent, the guard off or orch disabled passes', WITH_FRAME, async ($, on) => {
  world(on)
  on('agent.spawn', (_$, e) => ({ model: e.model ?? 'opus', agentId: 'sub-1' }))
  await start($)
  // no subagentType: orchSpawn reads it and throws, so the .catch answers
  const broken = { subagentType: undefined } as unknown as Partial<Args<'agent.spawn'>>
  expect((await spawnOf($)(broken)).deny).toMatch(/^Orchestrator mode \(orch\): guard error$/)
  expect(await spawnOf($)({ ...broken, parentAgentId: 'a1' })).toMatchObject({ agentId: 'sub-1' })
  await frame($, 'set', { key: 'orch_guard', value: 'off' })
  expect(await spawnOf($)(broken)).toMatchObject({ agentId: 'sub-1' })
  await frame($, 'set', { key: 'orch_guard', value: 'fable' })
  expect((await spawnOf($)(broken)).deny).toMatch(/guard error/)
  await frame($, 'set', { key: 'orch_enabled', value: false })
  expect(await spawnOf($)(broken)).toMatchObject({ agentId: 'sub-1' })
})

test('allow_fable_agents on lets an explicit Fable through both the Agent rule and agent.spawn; off refuses', { ...WITH_FRAME, options: { orch_allow_fable_agents: true } }, async ($, on) => {
  world(on)
  on('agent.spawn', (_$, e) => ({ model: e.model ?? 'opus', agentId: 'sub-1' }))
  await start($)
  const spawn = spawnOf($)
  const agent = (model: 'fable') => $.tool.call({ tool: 'Agent', prompt: 'p', description: 'd', subagent_type: 'general-purpose', model })
  expect(denial(await agent('fable'))).toBeUndefined()
  expect(await spawn({ model: 'fable' })).toMatchObject({ agentId: 'sub-1' })
  expect((await spawn({})).deny).toMatch(/would run on claude-fable-5-1/) // the parent's model: not an explicit ask
  await frame($, 'set', { key: 'orch_allow_fable_agents', value: false })
  expect(denial(await agent('fable'))).toMatch(/allow_fable_agents on \(\/junkd:orch panel\)/)
  expect((await spawn({ model: 'fable' })).deny).toMatch(/would run on fable/)
})

// ------------------------------------------------------------------ orch_enabled

test('orch_enabled off at load: tool.call, agent.spawn and the .catch pass, guardState is inactive, the orch-off flag is written; the pane still works', { ...WITH_FRAME, options: { orch_enabled: false, orch_guard: 'always' } }, async ($, on) => {
  const rec = world(on)
  on('agent.spawn', (_$, e) => ({ model: e.model ?? 'opus', agentId: 'sub-1' }))
  await start($)
  expect(OFF_FLAG in rec.files, 'off at load: the flag is written at session start').toBe(true)
  expect(RULES_FLAG in rec.files, 'inject_rules is on: its own flag stays away').toBe(false)
  expect(denial(await edit($))).toBeUndefined()
  expect(denial(await $.tool.call({ tool: 'Bash', command: 'git push --force' }))).toBeUndefined()
  expect(denial(await $.tool.call({ tool: 'Agent', prompt: 'p', description: 'd', subagent_type: 'fork' }))).toBeUndefined()
  expect(await spawnOf($)({ fork: true, subagentType: 'fork' })).toMatchObject({ agentId: 'sub-1' })
  expect(await spawnOf($)({ model: 'fable' })).toMatchObject({ agentId: 'sub-1' })
  expect(await frame($, 'guardState')).toEqual({ active: false, model: FABLE })
  rec.envFails = true // the guard reads nothing while off, so nothing throws and nothing refuses
  expect(denial(await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' }))).toBeUndefined()
  rec.envFails = false
  rec.model = undefined // no model: inactive, and no fable-guard toast
  expect(await frame($, 'guardState')).toEqual({ active: false, model: '' })
  expect(rec.toasts).toEqual([])
  expect(await frame($, 'get', { key: 'orch_enabled' })).toBe(false)
  await orchCmd($, 'panel')
  expect(rec.opened).toEqual(['orch'])
})

test('orch_enabled on at load (the manifest default, or true): the guard holds and a stale orch-off flag is removed at session start', { ...WITH_FRAME, options: { orch_enabled: true } }, async ($, on) => {
  const rec = world(on)
  rec.files[OFF_FLAG] = ''
  rec.files[RULES_FLAG] = '' // inject_rules is on too: both stale flags go
  await start($)
  expect(OFF_FLAG in rec.files).toBe(false)
  expect(RULES_FLAG in rec.files).toBe(false)
  expect(rec.runs).toContainEqual(['rm', '-f', '--', OFF_FLAG])
  expect(denial(await edit($))).toMatch(/may not run Edit/)
  expect(await frame($, 'guardState')).toEqual({ active: true, model: FABLE })
})

test('orch_enabled through $.junkd.set, one assertion per spelling: off releases the guard and writes the flag, on holds it and removes the flag', WITH_FRAME, async ($, on) => {
  const rec = world(on)
  on('agent.spawn', (_$, e) => ({ model: e.model ?? 'opus', agentId: 'sub-1' }))
  await start($)
  for (const off of [false, 'false', 'off']) {
    expect(await frame($, 'set', { key: 'orch_enabled', value: true })).toBe(true)
    expect(await frame($, 'set', { key: 'orch_enabled', value: off }), String(off)).toBe(false)
    expect(rec.config.at(-1), String(off)).toEqual({ key: 'junkd.orch_enabled', value: false })
    expect(await frame($, 'get', { key: 'orch_enabled' }), String(off)).toBe(false)
    expect(denial(await edit($)), String(off)).toBeUndefined()
    expect(await spawnOf($)({ model: 'fable' }), String(off)).toMatchObject({ agentId: 'sub-1' })
    expect(await frame($, 'guardState'), String(off)).toEqual({ active: false, model: FABLE })
    expect(OFF_FLAG in rec.files, String(off)).toBe(true)
  }
  for (const on_ of [true, 'true', 'on']) {
    expect(await frame($, 'set', { key: 'orch_enabled', value: false })).toBe(false)
    expect(await frame($, 'set', { key: 'orch_enabled', value: on_ }), String(on_)).toBe(true)
    expect(rec.config.at(-1), String(on_)).toEqual({ key: 'junkd.orch_enabled', value: true })
    expect(denial(await edit($)), String(on_)).toMatch(/may not run Edit/)
    expect((await spawnOf($)({ model: 'fable' })).deny, String(on_)).toMatch(/would run on fable/)
    expect(await frame($, 'guardState'), String(on_)).toEqual({ active: true, model: FABLE })
    expect(OFF_FLAG in rec.files, String(on_)).toBe(false)
  }
  // any other value is off, as the switch rows read it
  expect(await frame($, 'set', { key: 'orch_enabled', value: 'yes' })).toBe(false)
  expect(denial(await edit($))).toBeUndefined()
})

test('orch_enabled through the /config menu, one assertion per spelling: the same coercion, the same gates and the same flag', WITH_FRAME, async ($, on) => {
  const rec = world(on)
  await start($)
  for (const off of [false, 'false', 'off']) {
    await frame($, 'config', { key: 'junkd.orch_enabled', value: true })
    const r = (await frame($, 'config', { key: 'junkd.orch_enabled', value: off })) as { value?: unknown }
    expect(r.value, String(off)).toBe(false)
    expect(rec.config.at(-1), String(off)).toEqual({ key: 'junkd.orch_enabled', value: false })
    expect(await frame($, 'get', { key: 'orch_enabled' }), String(off)).toBe(false)
    expect(denial(await edit($)), String(off)).toBeUndefined()
    expect(OFF_FLAG in rec.files, String(off)).toBe(true)
  }
  for (const on_ of [true, 'true', 'on']) {
    await frame($, 'config', { key: 'junkd.orch_enabled', value: false })
    const r = (await frame($, 'config', { key: 'junkd.orch_enabled', value: on_ })) as { value?: unknown }
    expect(r.value, String(on_)).toBe(true)
    expect(await frame($, 'get', { key: 'orch_enabled' }), String(on_)).toBe(true)
    expect(denial(await edit($)), String(on_)).toMatch(/may not run Edit/)
    expect(await frame($, 'guardState'), String(on_)).toEqual({ active: true, model: FABLE })
    expect(OFF_FLAG in rec.files, String(on_)).toBe(false)
  }
})

test('a denied orch_enabled write leaves the guard and the flag file alone', WITH_FRAME, async ($, on) => {
  on('config.set', { key: 'junkd.orch_enabled' }, () => ({ deny: 'locked' }))
  const rec = world(on)
  await start($)
  await expect(frame($, 'set', { key: 'orch_enabled', value: false })).rejects.toThrow(/locked/)
  expect(OFF_FLAG in rec.files).toBe(false)
  expect(await frame($, 'get', { key: 'orch_enabled' })).toBe(true)
  expect(denial(await edit($))).toMatch(/may not run Edit/)
})

// ------------------------------------------------------------------ $.junkd's orch rows and the pane

const MANIFEST_KEYS = ['orch_enabled', 'orch_guard', 'orch_allow_fable_agents', 'orch_implementer_ctx_k', 'orch_ui_review', 'orch_inject_rules', 'orch_rounds']

test("$.junkd: the orch calls answer; schema's orch rows mirror the manifest; get answers the defaults; guard is the choice row", WITH_FRAME, async ($, on) => {
  world(on)
  await start($)
  expect(await frame($, 'members')).toEqual(['schema', 'get', 'set', 'open', 'orchGuardState'])
  const schema = ((await frame($, 'schema')) as { key: string; group: string; type: string; title: string; default: unknown; main: boolean; options?: string[] }[])
    .filter(f => f.group === 'orch')
  expect(schema.map(f => f.key)).toEqual(MANIFEST_KEYS)
  for (const f of schema) {
    expect(typeof f.default, f.key).toBe(f.type)
    expect(f.title, f.key).toMatch(/\S/)
    expect(await frame($, 'get', { key: f.key }), `get(${f.key}) is the manifest default`).toBe(f.default)
  }
  expect(schema.find(f => f.key === 'orch_guard')?.options).toEqual(['fable', 'always', 'off'])
  expect(schema.filter(f => f.main).map(f => f.key)).toEqual(['orch_enabled', 'orch_guard', 'orch_allow_fable_agents', 'orch_implementer_ctx_k'])
  await expect(frame($, 'get', { key: 'nope' })).rejects.toThrow(/no setting nope/)
  await expect(frame($, 'get', { key: 'orch_nope' })).rejects.toThrow(/no setting orch_nope/)
  await expect(frame($, 'get', { key: 'guard' })).rejects.toThrow(/no setting guard/) // the field alone is no key
})

test('$.junkd.set writes junkd.orch_<field> through $.config and get reads it back; a bad value, scope, key or a denied row is refused', WITH_FRAME, async ($, on) => {
  on('config.set', { key: 'junkd.orch_rounds', value: 9 }, () => ({ deny: 'locked' })) // one write a hook refuses
  const rec = world(on)
  await start($)
  expect(await frame($, 'set', { key: 'orch_guard', value: 'always' })).toBe('always')
  expect(rec.config).toEqual([{ key: 'junkd.orch_guard', value: 'always' }])
  expect(await frame($, 'get', { key: 'orch_guard' })).toBe('always')
  expect(await frame($, 'set', { key: 'orch_ui_review', value: 'off', scope: 'user' })).toBe(false)
  expect(rec.config.at(-1)).toEqual({ key: 'junkd.orch_ui_review', value: false })
  expect(await frame($, 'set', { key: 'orch_allow_fable_agents', value: 'on' })).toBe(true)
  expect(await frame($, 'get', { key: 'orch_allow_fable_agents' })).toBe(true)
  // the exact bounds: in at 50, 1000, 1, 10; out one past each, and -5
  expect(await frame($, 'set', { key: 'orch_implementer_ctx_k', value: 50 })).toBe(50)
  expect(await frame($, 'set', { key: 'orch_implementer_ctx_k', value: 1000 })).toBe(1000)
  expect(await frame($, 'set', { key: 'orch_rounds', value: 1 })).toBe(1)
  expect(await frame($, 'set', { key: 'orch_rounds', value: '10' })).toBe(10)
  const writes = rec.config.length
  for (const [key, value] of [['orch_implementer_ctx_k', 49], ['orch_implementer_ctx_k', 1001], ['orch_implementer_ctx_k', -5], ['orch_implementer_ctx_k', 400.5],
    ['orch_rounds', 0], ['orch_rounds', 11], ['orch_rounds', 'abc'], ['orch_guard', 'sometimes']] as const) {
    await expect(frame($, 'set', { key, value }), `${key}=${String(value)}`).rejects.toThrow(/not a valid/)
  }
  await expect(frame($, 'set', { key: 'orch_rounds', value: 2, scope: 'project' })).rejects.toThrow(/scope project/)
  await expect(frame($, 'set', { key: 'orch_nope', value: 1 })).rejects.toThrow(/no setting orch_nope/)
  expect(rec.config.length).toBe(writes) // none of the refusals reached $.config
  expect(await frame($, 'get', { key: 'orch_rounds' })).toBe(10)
  expect(await frame($, 'get', { key: 'orch_implementer_ctx_k' })).toBe(1000)
  // a config.set hook's deny comes back as the refusal and the value stays
  await expect(frame($, 'set', { key: 'orch_rounds', value: 9 })).rejects.toThrow(/locked/)
  expect(await frame($, 'get', { key: 'orch_rounds' })).toBe(10)
})

test('a write to an orch row by the /config menu, not $.junkd.set, is validated the same way and lands in get', WITH_FRAME, async ($, on) => {
  const rec = world(on)
  await start($)
  await frame($, 'config', { key: 'junkd.orch_guard', value: 'off' })
  expect(await frame($, 'get', { key: 'orch_guard' })).toBe('off')
  expect(denial(await edit($))).toBeUndefined()
  await frame($, 'config', { key: 'junkd.orch_rounds', value: 7 })
  expect(await frame($, 'get', { key: 'orch_rounds' })).toBe(7)
  const rows = rec.config.length
  for (const [key, value] of [['junkd.orch_rounds', 0], ['junkd.orch_rounds', 11], ['junkd.orch_rounds', 'abc'], ['junkd.orch_guard', 'maybe'], ['junkd.orch_implementer_ctx_k', 49]] as const) {
    const r = (await frame($, 'config', { key, value })) as { deny?: string }
    expect(r.deny, `${key}=${String(value)}`).toMatch(/not a valid/)
  }
  expect(rec.config.length).toBe(rows)
  expect(await frame($, 'get', { key: 'orch_rounds' })).toBe(7)
  await frame($, 'config', { key: 'other.rounds', value: 0 }) // another plugin's row passes untouched
  expect(rec.config.at(-1)).toEqual({ key: 'other.rounds', value: 0 })
  await frame($, 'config', { key: 'orch.rounds', value: 0 }) // the old plugin's row is no row of junkd's
  expect(rec.config.at(-1)).toEqual({ key: 'orch.rounds', value: 0 })
  expect(await frame($, 'get', { key: 'orch_rounds' })).toBe(7)
  expect((await frame($, 'config', { key: 'junkd.orch_nope', value: 'x' })) as { deny?: string }).toEqual({ value: 'x' }) // an orch row this version lacks: not ours to judge
  expect(rec.config.at(-1)).toEqual({ key: 'junkd.orch_nope', value: 'x' })
})

test('inject_rules mirrors into the flag file scripts/orch-context.sh checks: off writes it, on removes it, session start syncs it', { ...WITH_FRAME, options: { orch_inject_rules: false } }, async ($, on) => {
  const rec = world(on)
  await start($)
  expect(RULES_FLAG in rec.files, 'off at load: the flag is written at session start').toBe(true)
  expect(OFF_FLAG in rec.files, 'enabled is on: its own flag stays away').toBe(false)
  await frame($, 'set', { key: 'orch_inject_rules', value: true })
  expect(rec.runs.at(-1)).toEqual(['rm', '-f', '--', RULES_FLAG])
  expect(RULES_FLAG in rec.files).toBe(false)
  await frame($, 'config', { key: 'junkd.orch_inject_rules', value: false }) // the /config menu's path
  expect(RULES_FLAG in rec.files).toBe(true)
  await frame($, 'set', { key: 'orch_inject_rules', value: 'on' })
  expect(RULES_FLAG in rec.files).toBe(false)
  expect(OFF_FLAG in rec.files).toBe(false)
})

test('a directory under a flag name is never written over or removed: one toast, and the shell hook (-f) ignores it', { ...WITH_FRAME, options: { orch_inject_rules: false, orch_enabled: false } }, async ($, on) => {
  const rec = world(on)
  rec.dirs.push(RULES_FLAG, OFF_FLAG)
  await start($)
  for (const [flag, key] of [[RULES_FLAG, 'orch_inject_rules'], [OFF_FLAG, 'orch_enabled']] as const) {
    const field = key.slice('orch_'.length)
    expect(flag in rec.files, `no flag written over the directory ${flag}`).toBe(false)
    expect(rec.toasts.filter(t => t === `orch: ${flag} is not a file, so the ${field} setting is not mirrored there; remove it`).length, flag).toBe(1)
    await frame($, 'set', { key, value: true })
    expect(rec.runs.some(r => r[0] === 'rm' && r.includes(flag)), `${flag} never removed`).toBe(false)
    expect(await frame($, 'get', { key }), key).toBe(true) // the row still takes the value
  }
  // a real file there is ours: written and removed as before
  rec.dirs.length = 0
  for (const [flag, key] of [[RULES_FLAG, 'orch_inject_rules'], [OFF_FLAG, 'orch_enabled']] as const) {
    await frame($, 'set', { key, value: false })
    expect(flag in rec.files, flag).toBe(true)
  }
})

test('a denied inject_rules write leaves the flag file alone', WITH_FRAME, async ($, on) => {
  on('config.set', { key: 'junkd.orch_inject_rules' }, () => ({ deny: 'locked' }))
  const rec = world(on)
  await start($)
  await expect(frame($, 'set', { key: 'orch_inject_rules', value: false })).rejects.toThrow(/locked/)
  expect(RULES_FLAG in rec.files).toBe(false)
  expect(await frame($, 'get', { key: 'orch_inject_rules' })).toBe(true)
})

test('/junkd:orch panel and $.junkd.open toggle the pane; q closes it; a plain /junkd:orch passes down; the pane has no tab', WITH_FRAME, async ($, on) => {
  const rec = world(on)
  on('command.run', { command: 'junkd:orch' }, (_$, e) => ({ text: `downstream ${e.args}` }))
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
  // a route is handoff's: the orch pane has none, and nothing opens or closes
  for (const route of ['auto', 'settings'])
    await expect(frame($, 'open', { pane: 'orch', route }), route).rejects.toThrow(new RegExp(`junkd: the orch pane has no tab ${route}`))
  expect(rec.opened.length).toBe(2)
  expect(rec.closed.length).toBe(2)
  await orchCmd($, 'panel')
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'junkd', surface, ...PANE })
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
const shut = ($: Engine) => run($, 'shut', '')
const orchOpens = (rec: ReturnType<typeof world>) => rec.opened.flatMap((id, i) => (id === 'orch' ? [rec.focus[i]] : []))
const orchCloses = (rec: ReturnType<typeof world>) => rec.closed.filter(id => id === 'orch').length

test('the /junkd set shows the orch pane unfocused, marked as its own, and closes it again; a hide of a pane never opened is no error', async ($, on) => {
  const rec = world(on)
  await start($)
  await junkdCmd($)
  // the set first closes a feature pane it does not own (never opened here: the close goes out quietly), then shows it
  expect(orchCloses(rec)).toBe(1)
  expect(orchOpens(rec)).toEqual([undefined]) // no focus asked: junkd keeps the keys
  await junkdCmd($) // the set closes: orch is still its own
  expect(orchCloses(rec)).toBe(2)
  await orchCmd($, 'panel') // its own command still asks for the keys
  expect(orchOpens(rec)).toEqual([undefined, true])
})

test('closing the /junkd set closes the orch pane only while it is still the set\'s: a reopen, the person\'s close or a reopen of an unplaced pane takes the mark', { plugins: [SHUTTER] }, async ($, on) => {
  const rec = world(on)
  await start($)
  // Closed and opened by its own command since: no longer the set's, so closing the set leaves it up.
  await junkdCmd($)
  expect(orchCloses(rec)).toBe(1)
  await orchCmd($, 'panel')
  expect(orchCloses(rec)).toBe(2)
  await orchCmd($, 'panel')
  await junkdCmd($)
  expect(orchCloses(rec)).toBe(2)

  // The person's close clears the mark too.
  await junkdCmd($) // the set again: its feature pane closes first, then opens as the set's
  expect(orchCloses(rec)).toBe(3)
  await shut($)
  expect(orchCloses(rec)).toBe(4)
  await junkdCmd($)
  expect(orchCloses(rec)).toBe(4)

  // Shown but not placed (a narrow terminal), then opened by /junkd:orch panel: the person's now.
  rec.notPlaced = true
  await junkdCmd($)
  expect(orchCloses(rec)).toBe(5)
  await orchCmd($, 'panel')
  expect(rec.opened.at(-1)).toBe('orch')
  await junkdCmd($)
  expect(orchCloses(rec)).toBe(5)

  // Shown and left as the set's: closing the set closes it.
  rec.notPlaced = false
  await junkdCmd($)
  expect(orchCloses(rec)).toBe(6)
  await junkdCmd($)
  expect(orchCloses(rec)).toBe(7)
})

// Every word drawn: the Texts and the Buttons' labels (a field's title is its hotkey Button).
const texts = async (ui: Mounted<Surface, 'Pane'>) =>
  [...(await ui.findAll({ type: 'Text' })).map(t => t.text), ...(await ui.findAll({ type: 'Button' })).map(b => String(b.props.label ?? ''))].join('\n')
async function hotkey(ui: Mounted<Surface, 'Pane'>, key: string) {
  const b = (await ui.findAll({ type: 'Button' })).find(x => x.props.hotkey === key)
  expect(b?.key, `a Button with hotkey ${key}`).toBeDefined()
  await ui.press({ key: b!.key! })
}

test('the pane: seven rows; a letter flips a switch, enter in a field saves it, the choice row picks the guard, tab is a hint', WITH_FRAME, async ($, on) => {
  const rec = world(on)
  await start($)
  await orchCmd($, 'panel')
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'junkd', surface, ...PANE })
    const t = await texts(ui)
    for (const title of ['Orchestrator: enabled', 'Main-loop guard', 'Allow Fable subagents', 'Implementer context cap (k tokens)', 'UI review', 'Inject orchestrator rules', 'Fix rounds'])
      expect(t, title).toContain(title)
    expect(t).toContain('tab')
    expect(t).toContain('enter')
    expect(t).toContain('/junkd:orch')
    // letters: a enabled, b allow_fable_agents, c implementer_ctx_k, d ui_review, e inject_rules, f rounds
    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons.filter(b => /^[a-f]$/.test(String(b.props.hotkey ?? ''))).map(b => b.key).sort()).toEqual(
      ['orch:allow_fable_agents', 'orch:enabled', 'orch:implementer_ctx_k-focus', 'orch:inject_rules', 'orch:rounds-focus', 'orch:ui_review'],
    )
    const before = rec.config.length
    await hotkey(ui, 'a')
    expect(rec.config.at(-1)).toEqual({ key: 'junkd.orch_enabled', value: false })
    expect(await frame($, 'get', { key: 'orch_enabled' })).toBe(false) // a round trip: the flag's write settles too
    expect(OFF_FLAG in rec.files).toBe(true)
    expect(denial(await edit($))).toBeUndefined()
    await hotkey(ui, 'a')
    expect(rec.config.at(-1)).toEqual({ key: 'junkd.orch_enabled', value: true })
    await frame($, 'get', { key: 'orch_enabled' })
    expect(OFF_FLAG in rec.files).toBe(false)
    expect(denial(await edit($))).toMatch(/may not run Edit/)
    await hotkey(ui, 'b')
    expect(rec.config.at(-1)).toEqual({ key: 'junkd.orch_allow_fable_agents', value: true })
    expect(await frame($, 'get', { key: 'orch_allow_fable_agents' })).toBe(true)
    await hotkey(ui, 'b')
    expect(rec.config.at(-1)).toEqual({ key: 'junkd.orch_allow_fable_agents', value: false })
    await hotkey(ui, 'd')
    expect(rec.config.at(-1)).toEqual({ key: 'junkd.orch_ui_review', value: false })
    expect(await frame($, 'get', { key: 'orch_ui_review' })).toBe(false)
    await hotkey(ui, 'd')
    expect(rec.config.at(-1)).toEqual({ key: 'junkd.orch_ui_review', value: true })
    await hotkey(ui, 'e')
    expect(rec.config.at(-1)).toEqual({ key: 'junkd.orch_inject_rules', value: false })
    await frame($, 'get', { key: 'orch_inject_rules' }) // a round trip: the press settles before the flag file's write does
    expect(RULES_FLAG in rec.files).toBe(true)
    await hotkey(ui, 'e')
    await frame($, 'get', { key: 'orch_inject_rules' })
    expect(RULES_FLAG in rec.files).toBe(false)
    // c and f ask the focus ring onto the number fields; the kit implements no $.ui.focus (no hook of the test's or
    // of another plugin's is reached), so only that the press settles and the pane stays is checked here
    await hotkey(ui, 'c')
    await hotkey(ui, 'f')
    expect(await ui.find({ key: 'orch:rounds-focus' })).toBeDefined()
    // the choice row: the other options are Buttons, the current one is text
    expect((await ui.find({ key: 'orch:guard=fable' }))?.type).toBe('Box')
    expect(await ui.find({ type: 'Button', key: 'orch:guard=fable' })).toBeUndefined()
    await ui.press({ key: 'orch:guard=always' })
    expect(rec.config.at(-1)).toEqual({ key: 'junkd.orch_guard', value: 'always' })
    expect(await frame($, 'get', { key: 'orch_guard' })).toBe('always')
    await ui.press({ key: 'orch:guard=fable' })
    expect(rec.config.at(-1)).toEqual({ key: 'junkd.orch_guard', value: 'fable' })
    // enter in a number field saves a whole number in range; out of range or not a number: a note, no write
    const field = (await ui.findAll({ type: 'Input' })).find(i => /^orch:rounds/.test(i.key ?? ''))
    expect(field?.key, 'the rounds Input').toBeDefined()
    await ui.input({ key: field!.key!, text: '5' })
    expect(rec.config.at(-1)).toEqual({ key: 'junkd.orch_rounds', value: 5 })
    expect(await frame($, 'get', { key: 'orch_rounds' })).toBe(5)
    const writes = rec.config.length
    for (const text of ['11', '0', '2.5', 'x', '']) {
      const f = (await ui.findAll({ type: 'Input' })).find(i => /^orch:rounds/.test(i.key ?? ''))
      await ui.input({ key: f!.key!, text })
      expect(await texts(ui), text).toMatch(/rounds takes a whole number 1–10/)
    }
    expect(rec.config.length).toBe(writes)
    const ctx = (await ui.findAll({ type: 'Input' })).find(i => /^orch:implementer_ctx_k/.test(i.key ?? ''))
    await ui.input({ key: ctx!.key!, text: '1000' })
    expect(rec.config.at(-1)).toEqual({ key: 'junkd.orch_implementer_ctx_k', value: 1000 })
    await ui.input({ key: (await ui.findAll({ type: 'Input' })).find(i => /^orch:implementer_ctx_k/.test(i.key ?? ''))!.key!, text: '1001' })
    expect(rec.config.at(-1)).toEqual({ key: 'junkd.orch_implementer_ctx_k', value: 1000 })
    expect(rec.config.length).toBeGreaterThan(before)
    await ui.unmount()
  }
  // a mobile surface gets the engine's own drawing, not the pane
  const mobile = await $.ui.mount({ plugin: 'junkd', surface: 'mobile', ...PANE })
  expect(await mobile.find({ key: 'engine' })).toBeDefined()
  expect(await mobile.find({ type: 'Button', key: 'close' })).toBeUndefined()
  await mobile.unmount()
})
