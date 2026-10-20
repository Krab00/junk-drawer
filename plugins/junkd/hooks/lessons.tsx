// The lessons loop's module side: the lessons tab (junkd-lessons, after tools in the /junkd set), the 📒 segment
// under the prompt, the blocking dialog and its one context line, and /junkd:lessons. Reads go through lessons.ts's
// parser over the three stores; every write is a run of the CLI (`orch-state lesson …`), the one writer.
// - The stores: <tasks_dir>/_lessons.md of the orch root (local), <root>/lessons.md (repo), ${CLAUDE_CONFIG_DIR}/junkd/
//   lessons.md (global). Read again at session start, at each main-loop turn's end, after each write, on `r`.
// - The dialog: at the session start of an orch session (orch and orch_lessons on, a .orch/config.md at the root) with
//   lessons pending, when the main loop's answer prints a `BACKLOG:` line, and when /junkd:orch starts a run: the tab
//   opens focused with its top line, and every prompt of the main loop carries one context line until none is pending.
// - Off (orch_enabled or orch_lessons off): no tab, no segment, no dialog, no line; the files are left alone.
import type { On, RenderInput } from 'claude-code'
import type { $, HideInput, ShowInput } from './feature'
import { isSets, shutSet } from './set'
import { orchRoot, tasksDirOf } from './dashboard.ts'
import { O } from './orch-lib'
import {
  L, argvOf, binPaths, contextLine, detectStacks, findLesson, moveSelection, needsConfirm, parseCommand, parseLessons, pendingOf, resetLessons,
  segmentText, selectedLesson, type Action, type Lesson, type Scope,
} from './lessons.ts'
import { lessonsView, type Els } from './lessons-views'

export const LESSONS_PANE_ID = 'junkd-lessons'
export const OFF_TEXT = 'junkd: the lessons loop is off: /junkd → orch → Lessons loop'
const BACKLOG = /^BACKLOG: /m
const reason = (err: unknown) => (err as Error)?.message ?? String(err)

let owner: string | undefined
export const lessonsOn = () => O.enabled && O.lessons

function redraw($: $) {
  return $.ui.invalidate('ui.render')
}

let home = ''
async function homeDir($: $): Promise<string> {
  if (home) return home
  home = (await $.env.get('HOME')) ?? ''
  if (!home) home = (await $.process.run(['sh', '-c', 'echo $HOME'])).stdout.trim()
  return home
}
// Paths follow CLAUDE_CONFIG_DIR like Claude Code itself; tests point it at a fake tree.
async function configDir($: $) {
  return (await $.env.get('CLAUDE_CONFIG_DIR')) || `${await homeDir($)}/.claude`
}

// The stores ---------------------------------------------------------------------------------------------------------

type Where = { cwd: string; root: string; files: Partial<Record<Scope, string>>; orch: boolean }
// The session's directory, its git toplevel (climbing out of a task worktree to the checkout with .orch/, as
// orch-state does), and the three files. No repo: the global store alone. No .orch/config.md: no local store.
async function where($: $): Promise<Where> {
  const cwd = await $.session.cwd().catch(() => '')
  const global = `${await configDir($)}/junkd/lessons.md`
  const git = cwd ? await $.process.run(['git', '-C', cwd, 'rev-parse', '--show-toplevel']).catch(() => undefined) : undefined
  const top = git?.exitCode === 0 ? git.stdout.trim() : ''
  if (!top) return { cwd, root: '', files: { global }, orch: false }
  const has = new Set<string>()
  for (let up = top; ; up = up.slice(0, up.lastIndexOf('/.worktrees/'))) {
    if (await $.fs.exists(`${up}/.orch`).catch(() => false)) has.add(up)
    if (!up.includes('/.worktrees/')) break
  }
  const root = orchRoot(top, d => has.has(d))
  const config = await $.fs.read(`${root}/.orch/config.md`).catch(() => undefined)
  const files: Partial<Record<Scope, string>> = { repo: `${root}/lessons.md`, global }
  if (config !== undefined) files.local = `${root}/${tasksDirOf(config)}/_lessons.md`
  return { cwd, root, files, orch: config !== undefined }
}

// The repo's stack tags (lessons.ts's detectStacks over git's file list), once per root.
const stacks = new Map<string, string[]>()
async function repoStacks($: $, root: string): Promise<string[]> {
  if (!root) return ['any']
  const known = stacks.get(root)
  if (known) return known
  const r = await $.process.run(['git', '-C', root, 'ls-files', '-co', '--exclude-standard']).catch(() => undefined)
  const paths = r?.exitCode === 0 ? r.stdout.split('\n').filter(Boolean) : []
  const first: Record<string, string> = {}
  for (const p of binPaths(paths).slice(0, 50)) {
    const text = await $.fs.read(`${root}/${p}`).catch(() => undefined)
    if (text !== undefined) first[p] = text.split('\n', 1)[0] ?? ''
  }
  const found = detectStacks(paths, p => first[p])
  if (r?.exitCode === 0) stacks.set(root, found)
  return found
}

// Every lesson of the stores that exist; a store that cannot be read keeps what was read of it last, and says so.
let last: Partial<Record<Scope, Lesson[]>> = {}
let loads = 0
async function load($: $): Promise<Where | undefined> {
  if (!lessonsOn()) return undefined
  const gen = ++loads
  const w = await where($)
  const read: Partial<Record<Scope, Lesson[]>> = {}
  const failed: string[] = []
  for (const scope of ['local', 'repo', 'global'] as const) {
    const file = w.files[scope]
    if (!file) continue
    const exists = await $.fs.exists(file).catch(() => undefined)
    if (exists === false) {
      read[scope] = []
      continue
    }
    const text = exists ? await $.fs.read(file).catch(() => undefined) : undefined
    if (text === undefined) {
      failed.push(file)
      read[scope] = last[scope] ?? []
      continue
    }
    read[scope] = parseLessons(text, scope)
  }
  const found = await repoStacks($, w.root)
  if (gen !== loads) return w
  last = read
  L.lessons = [...(read.local ?? []), ...(read.repo ?? []), ...(read.global ?? [])]
  L.repoStacks = found
  L.orch = w.orch
  L.loaded = true
  if (failed.length) L.note = `✗ could not read ${failed.join(', ')}`
  if (!pendingOf(L.lessons).length) {
    L.blocking = false
    L.confirm = ''
  }
  redraw($)
  return w
}

// The CLI, in the session's directory (orch-state finds the stores from there): its first line, or its error.
async function runCli($: $, argv: string[]): Promise<{ ok: boolean; text: string }> {
  try {
    const cwd = (await where($)).cwd
    const r = await $.process.run(['sh', '-c', 'cd -- "$1" && shift && exec "$@"', 'sh', cwd || '.', `${$.plugin.root}/bin/orch-state`, ...argv])
    const out = r.stdout.trim().split('\n')[0] ?? ''
    const err = r.stderr.trim().split('\n').at(-1) ?? ''
    return r.exitCode === 0 ? { ok: true, text: out } : { ok: false, text: err || out || `orch-state exited ${r.exitCode}` }
  } catch (err) {
    return { ok: false, text: reason(err) }
  }
}
async function act($: $, action: Action, l: Lesson, confirmed = false): Promise<string> {
  const r = await runCli($, argvOf(action, l, confirmed))
  L.note = r.ok ? `✓ ${r.text}` : `✗ ${r.text}`
  L.confirm = ''
  await load($)
  redraw($)
  return L.note
}

// The tab's keys: p promotes the selected lesson (a check or a role asks first), d drops it, u moves it a store up.
function selected(): Lesson | undefined {
  return selectedLesson(pendingOf(L.lessons))
}
function press($: $, action: Action) {
  const l = selected()
  if (!l) return
  if (action === 'promote' && needsConfirm(l)) {
    L.confirm = l.ref
    redraw($)
    return
  }
  void act($, action, l)
}

// The pane ---------------------------------------------------------------------------------------------------------

// `$.ui.open` before any await: only an open made while the press or command runs counts as asked.
async function openPane($: $, focus: boolean) {
  const opened = $.ui.open({ id: LESSONS_PANE_ID, title: 'lessons', focus: focus || undefined })
  owner = undefined
  L.open = true
  void load($)
  await opened.catch(err => {
    L.open = false
    throw err
  })
}
// The engine does not raise our own `$.ui.close` to our ui.close hook, so the state is cleared here.
async function closePane($: $) {
  L.open = false
  L.confirm = ''
  owner = undefined
  await $.ui.close({ id: LESSONS_PANE_ID })
}

// The dialog: the tab, focused, with its top line; the context line rides along from the next prompt on.
async function openDialog($: $): Promise<void> {
  if (!lessonsOn() || !pendingOf(L.lessons).length) return
  L.blocking = true
  await openPane($, true).catch(() => undefined) // a refused open: the segment and the line remain
  redraw($)
}

// what index.tsx, dispatch.ts, orch.tsx and handoff.tsx call ----------------------------------------------------------

// show opens the tab and never closes it; `owner` marks it as that caller's, for hide. Off: refused with the reason.
export async function lessonsShow($: $, input: ShowInput = {}): Promise<void> {
  if (input.route !== undefined) throw new Error(`junkd: the lessons pane has no tab ${String(input.route)}`)
  if (!lessonsOn()) throw new Error(OFF_TEXT)
  const opened = openPane($, input.focus === true)
  owner = input.owner
  await opened
}
export async function lessonsHide($: $, input: HideInput = {}): Promise<void> {
  if (input.owner !== undefined && input.owner !== owner) return
  await closePane($)
}
// open toggles the tab, as /junkd:lessons does.
export async function lessonsOpen($: $, input: { route?: string } = {}): Promise<void> {
  if (input.route !== undefined) throw new Error(`junkd: the lessons pane has no tab ${String(input.route)}`)
  if (!lessonsOn()) throw new Error(OFF_TEXT)
  if (L.open) return closePane($)
  return openPane($, true)
}

// Session start (index.tsx): read the stores; an orch session with lessons pending opens the dialog.
export async function lessonsStart($: $): Promise<void> {
  L.blocking = false
  L.confirm = ''
  if (!lessonsOn()) return
  const w = await load($)
  if (w?.orch) await openDialog($)
}

// handoff.tsx's turn.complete: the main loop's turn read the stores again; an answer that prints `BACKLOG:` with
// lessons pending is a run that would end: the dialog. Never throws.
export async function lessonsTurnEnd($: $, e: { agentId?: string; answer?: unknown }): Promise<void> {
  try {
    if (!lessonsOn() || e.agentId) return
    await load($)
    if (BACKLOG.test(String(e.answer ?? ''))) await openDialog($)
  } catch {}
}

// orch.tsx's /junkd:orch, before a run falls through to the skill: lessons pending open the dialog first.
export async function lessonsRunStart($: $): Promise<void> {
  try {
    if (!lessonsOn()) return
    await load($)
    await openDialog($)
  } catch {}
}

// index.tsx's prompt.submit: the line for the main loop while the dialog stands and lessons are pending.
export async function lessonsPromptLine($: $): Promise<string | undefined> {
  if (!lessonsOn() || !L.blocking) return undefined
  await load($).catch(() => undefined)
  const n = pendingOf(L.lessons).length
  return L.blocking && n ? contextLine(n) : undefined
}

// orch.tsx's apply: off closes the tab and drops the dialog; on reads the stores.
export async function lessonsApplied($: $): Promise<void> {
  if (lessonsOn()) {
    await load($).catch(() => undefined)
    return
  }
  L.blocking = false
  L.confirm = ''
  if (L.open) await closePane($).catch(() => undefined)
  redraw($)
}

// The 📒 segment under the prompt (warning): the pending count; a press opens the tab. None at 0 or while off.
export function lessonsSegment($: $, e: RenderInput<'PromptHint'>) {
  const text = lessonsOn() ? segmentText(pendingOf(L.lessons).length) : ''
  if (!text) return undefined
  const { Button, Text } = $.ui.resolve(e)
  return (
    <Button key="junkd-lessons" plain label={text} onPress={() => void lessonsShow($, { focus: true }).catch(err => $.ui.toast(`✗ ${reason(err)}`))}>
      <Text color="warning">{text}</Text>
    </Button>
  )
}

// /junkd:lessons: the tab, or one action on a lesson by its id (the CLI's answer as the reply).
async function command($: $, args: string): Promise<{ text?: string }> {
  if (!lessonsOn()) return { text: OFF_TEXT }
  const c = parseCommand(args)
  if (c.kind === 'error') return { text: c.text }
  try {
    if (c.kind === 'toggle') await lessonsOpen($)
    else if (c.kind === 'list') {
      if (!L.open) await openPane($, true)
    } else {
      await load($)
      const l = findLesson(L.lessons, c.id)
      if (typeof l === 'string') return { text: l }
      return { text: await act($, c.kind, l) }
    }
  } catch (err) {
    return { text: `✗ ${reason(err)}` }
  }
  return {}
}

export function registerLessons(on: On, _options: Record<string, unknown>): void {
  owner = undefined
  last = {}
  loads = 0
  stacks.clear()
  resetLessons()

  on('command.run', { command: 'junkd:lessons' }, async ($, e) => command($, e.args))

  // The arrows move the focus ring along the rows: the row it lands on is the selection.
  on('ui.focus', { requestId: LESSONS_PANE_ID }, ($, e, next) => {
    if (e.element?.startsWith('lesson:')) {
      L.selected = e.element.slice('lesson:'.length)
      redraw($)
    }
    return next(e)
  })

  // The person's closes (q, ×) pass here; ours go through closePane.
  on('ui.close', { id: LESSONS_PANE_ID }, async ($, e, next) => {
    const isSet = isSets(owner)
    L.open = false
    L.confirm = ''
    owner = undefined
    const r = await next(e)
    if (isSet) await shutSet($)
    return r
  })

  on('ui.render', { component: 'Pane', requestId: LESSONS_PANE_ID }, ($, e: RenderInput<'Pane'>, next) => {
    if (e.surface === 'mobile' || !lessonsOn()) return next(e)
    return lessonsView($.ui.resolve(e) as Els, e.props, {
      close: () => void (isSets(owner) ? shutSet($) : closePane($)),
      promote: () => press($, 'promote'),
      drop: () => press($, 'drop'),
      up: () => press($, 'up'),
      reload: () => {
        L.note = ''
        void load($)
      },
      yes: () => {
        const l = pendingOf(L.lessons).find(x => x.ref === L.confirm)
        if (l) void act($, 'promote', l, true)
      },
      no: () => {
        L.confirm = ''
        L.note = ''
        redraw($)
      },
      move: by => {
        moveSelection(pendingOf(L.lessons), by)
        redraw($)
      },
      select: ref => {
        L.selected = ref
        redraw($)
      },
    })
  })
}
