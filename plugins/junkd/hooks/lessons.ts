// The lessons loop's `$`-free side: the reader of the three stores' blocks, the stack filter, the pending rule, the
// texts of the 📒 segment and the injected line, and the argv of each write (the one writer is the CLI,
// `orch-state lesson …`; this file never writes a store). lessons.tsx is the `$` side, lessons-views.tsx the tab.
//
// A store holds one block per lesson, from its heading to the next `## ` line:
//   ## L<n> (<YYYY-MM-DD>) scope: local|repo|global · stack: <tags> · to: <target> · from: T<id>
//   <2–3 sentences>
// A `## ` heading of another shape (the old diary's `## T8 (…)`) is no lesson. The rules match bin/orch-state's.

export type Scope = 'local' | 'repo' | 'global'
export const SCOPES: readonly Scope[] = ['local', 'repo', 'global']
export const STACK_TAGS = ['node', 'python', 'shell', 'tsx-mods', 'go', 'rust', 'any'] as const
export const TARGETS = ['test', 'smoke', 'check', 'role', 'repo', 'global', 'drop'] as const

export type Lesson = {
  ref: string // `<scope>:L<n>`, the id the CLI takes whatever store holds it
  id: string
  scope: Scope
  date: string
  stack: string[]
  to: string // '' when the block names none
  from: string
  text: string // the body as one line
  pending: boolean
}

const RANK: Record<Scope, number> = { local: 0, repo: 1, global: 2 }
// Pending unless its `to` is a store (repo, global) it has reached: a block without a `to`, a handed test and every
// other target wait for a decision.
export function isPending(scope: Scope, to: string): boolean {
  return !((to === 'repo' || to === 'global') && RANK[scope] >= RANK[to])
}
export const nextStore = (scope: Scope): Scope | undefined => (scope === 'local' ? 'repo' : scope === 'repo' ? 'global' : undefined)

const HEAD = /^## (L\d+) \((\d{4}-\d{2}-\d{2})\)(.*)$/

// One store's text to its lessons, in file order. A line's trailing CR is dropped (CRLF reads as LF; a lone CR inside a
// line is blank space, no line break); the body's runs of blanks are one space; a heading of another shape ends the
// block above and starts none. lessons-parity.ts pins this parser and bin/orch-state's awk to the same output.
export function parseLessons(text: string, scope: Scope): Lesson[] {
  const out: Lesson[] = []
  let cur: Lesson | undefined
  const body: string[] = []
  const flush = () => {
    if (cur) out.push({ ...cur, text: body.join(' ').replace(/[ \t\r]+/g, ' ').replace(/^ | $/g, '') })
    cur = undefined
    body.length = 0
  }
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line.startsWith('## ')) {
      flush()
      const m = HEAD.exec(line)
      if (!m) continue
      const fields: Record<string, string> = {}
      for (const part of m[3]!.split(' · ')) {
        const c = part.indexOf(':')
        if (c > 0) fields[part.slice(0, c).trim()] = part.slice(c + 1).trim()
      }
      const to = fields.to ?? ''
      const stack = (fields.stack || 'any').split(/[ ,]+/).filter(Boolean)
      cur = { ref: `${scope}:${m[1]}`, id: m[1]!, scope, date: m[2]!, stack, to, from: fields.from ?? '', text: '', pending: isPending(scope, to) }
      continue
    }
    if (cur) body.push(line)
  }
  flush()
  return out
}

// The stack filter: a lesson tagged `any`, or one that shares a tag with the repo's set.
export function meets(stack: readonly string[], repo: readonly string[]): boolean {
  return stack.some(t => t === 'any' || repo.includes(t))
}

// The repo's stack tags from its file list (paths relative to the root) and the first line of each `bin/*` file the
// caller could read; `any` when nothing matches. In the order the CLI prints them.
export function detectStacks(paths: readonly string[], firstLine: (path: string) => string | undefined): string[] {
  const has = (re: RegExp) => paths.some(p => re.test(p))
  const out: string[] = []
  if (has(/(^|\/)package\.json$/)) out.push('node')
  if (has(/(^|\/)(pyproject\.toml|requirements[^/]*\.txt)$/)) out.push('python')
  if (paths.some(p => /(^|\/)bin\/[^/]+$/.test(p) && /^#!.*[/ ]bash(\s|$)/.test(firstLine(p) ?? ''))) out.push('shell')
  if (has(/(^|\/)hooks\/[^/]+\.tsx$/)) out.push('tsx-mods')
  if (has(/(^|\/)go\.mod$/)) out.push('go')
  if (has(/(^|\/)Cargo\.toml$/)) out.push('rust')
  return out.length ? out : ['any']
}
export const binPaths = (paths: readonly string[]) => paths.filter(p => /(^|\/)bin\/[^/]+$/.test(p))

export const pendingOf = (lessons: readonly Lesson[]) => lessons.filter(l => l.pending)
// The text up to the first sentence's end.
export const firstSentence = (text: string) => /^(.*?[.!?])(\s|$)/.exec(text)?.[1] ?? text

// The texts the person and the orchestrator see.
export const segmentText = (n: number) => (n > 0 ? `📒 ${n}` : '')
export const topLine = (n: number) => `${n} lesson${n === 1 ? '' : 's'} pending — resolve them to finish the run`
export const contextLine = (n: number) => `lessons: ${n} pending, open /junkd lessons; the run is not finished`

// A promote that asks the person first: a row of the config (check) or a task of junk-drawer's backlog (role).
export const needsConfirm = (l: Lesson) => l.to === 'check' || l.to === 'role'
export function confirmText(l: Lesson): string {
  if (l.to === 'check') return `promote ${l.ref} into standing_checks_extra of .orch/config.md?`
  return `promote ${l.ref} into a role task (junk-drawer's backlog; elsewhere the text to paste)?`
}

// The CLI's argv after `orch-state` for each key of the tab and each /junkd:lessons action. A confirmed check
// carries --yes (the person said yes in the confirm line).
export type Action = 'promote' | 'drop' | 'up'
export function argvOf(action: Action, l: Lesson, confirmed = false): string[] {
  if (action === 'drop') return ['lesson', 'drop', l.ref]
  if (action === 'up') return ['lesson', 'up', l.ref]
  return ['lesson', 'promote', l.ref, ...(confirmed && l.to === 'check' ? ['--yes'] : [])]
}

// /junkd:lessons' arguments: nothing toggles the tab, `list` opens it, the three actions take an id (`L3` or
// `repo:L3`).
export type LessonsCommand = { kind: 'toggle' } | { kind: 'list' } | { kind: Action; id: string } | { kind: 'error'; text: string }
export const USAGE = 'junkd: /junkd:lessons [list | promote <id> | drop <id> | up <id>]'
export function parseCommand(args: string): LessonsCommand {
  const words = args.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return { kind: 'toggle' }
  const verb = words[0]!.toLowerCase()
  if (verb === 'list' && words.length === 1) return { kind: 'list' }
  if ((verb === 'promote' || verb === 'drop' || verb === 'up') && words.length === 2 && /^((local|repo|global):)?L\d+$/.test(words[1]!)) return { kind: verb, id: words[1]! }
  return { kind: 'error', text: USAGE }
}
// The one lesson an id names: `repo:L3` exactly, `L3` when one store has it.
export function findLesson(lessons: readonly Lesson[], id: string): Lesson | string {
  const hits = lessons.filter(l => (id.includes(':') ? l.ref === id : l.id === id))
  if (hits.length === 1) return hits[0]!
  if (!hits.length) return `junkd: no lesson ${id}`
  return `junkd: ${id} is in more than one store: ${hits.map(h => h.ref).join(', ')}`
}

// The tab's state: what was read last, the selection, the confirm line, the note, the dialog's top line.
export const L = {
  open: false,
  loaded: false,
  lessons: [] as Lesson[],
  repoStacks: ['any'] as string[],
  selected: '' as string, // a ref
  confirm: '' as string, // the ref awaiting y/n
  note: '',
  blocking: false, // the dialog: the top line and the injected line
  orch: false, // this session is an orch session (orch on, lessons on, a .orch/ at the root)
}
export function resetLessons(): void {
  Object.assign(L, { open: false, loaded: false, lessons: [], repoStacks: ['any'], selected: '', confirm: '', note: '', blocking: false, orch: false })
}
// The selection among the pending rows: kept while it is there, else the first row.
export function selectedLesson(rows: readonly Lesson[]): Lesson | undefined {
  return rows.find(l => l.ref === L.selected) ?? rows[0]
}
export function moveSelection(rows: readonly Lesson[], by: number): void {
  if (!rows.length) return
  const i = Math.max(0, rows.findIndex(l => l.ref === selectedLesson(rows)?.ref))
  L.selected = rows[Math.min(rows.length - 1, Math.max(0, i + by))]!.ref
}
