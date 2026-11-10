// egm: the model registry of the egm tab, `$`-free. The registry is ${CLAUDE_CONFIG_DIR:-~/.claude}/junkd/models.json,
// a flat JSON array of entries (no wrapper object), sorted by class (A, B, C, F) and then by id. egm-pane.tsx reads and
// writes the file and egm-views.tsx draws the tab; this file holds the schema, the one validation function the form
// and the JSON view share, the sort, the seed and the tab's state E.
//
// The list constants are written one per line as `export const NAME = [...] as const`: tests/smoke.sh compares them
// with the lists of skills/task-draft/bin/task-probe.

export const CLASSES = ['A', 'B', 'C', 'F'] as const
export const RESERVED = ['D', 'E'] as const
export const HARNESSES = ['claude', 'omp', 'opencode', 'codex', 'kimi'] as const
export const EFFORTS = ['default', 'none', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export const LEVELS = ['-', 'off', 'on', 'low', 'medium', 'high'] as const
export const PASSES = ['suffix', 'param'] as const
export const CLASS_HINT: Record<string, string> = { A: 'haiku', B: 'sonnet', C: 'opus', F: 'frontier' }
export const JSON_EXAMPLE = '{"class":"B","id":"openrouter/<vendor>/<model>","harness":"omp","effort":"default","thinking":{"level":"high","pass":"suffix"}}'

export type Entry = { class: string; id: string; harness: string; effort: string; thinking: { level: string; pass: string } }
// The form's draft: which way it is filled (`mode`, kept equal to E.view while the form is open), the entry as the
// choices left it, the id Input's unsaved text, the JSON Input's text, and the index of the edited entry (null: new).
export type Draft = { mode: 'form' | 'json'; entry: Entry; idText: string; json: string; editIndex: number | null }

const seedEntry = (cls: string, id: string): Entry => ({ class: cls, id, harness: 'claude', effort: 'default', thinking: { level: '-', pass: 'suffix' } })
export const SEED: readonly Entry[] = [seedEntry('A', 'haiku'), seedEntry('B', 'sonnet'), seedEntry('C', 'opus')]

const has = (list: readonly string[], value: unknown): boolean => typeof value === 'string' && list.includes(value)
// A parser message on one line: every run of whitespace one space.
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isMissing = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')

// The validation rules, checked in order; the first failure is the answer. A string is
// the JSON view's text: joined to one line (a multi-line paste) and parsed. The error is the note without its `✗ `.
export function parseEntry(raw: unknown): { entry: Entry } | { error: string } {
  let value = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw.replace(/\s*\r?\n\s*/g, ' '))
    } catch (err) {
      return { error: `JSON: ${oneLine(String((err as Error)?.message ?? err))}` }
    }
  }
  if (!isObject(value)) return { error: 'JSON: oczekiwany jeden obiekt {…}' }
  for (const key of ['class', 'id', 'harness']) if (isMissing(value[key])) return { error: `JSON: brak pola ${key}` }
  const cls = value.class
  if (has(RESERVED, cls)) return { error: `JSON: class ${String(cls)} to rezerwa, użyj A, B, C albo F` }
  if (!has(CLASSES, cls)) return { error: `JSON: class musi być A, B, C albo F, jest ${JSON.stringify(cls)}` }
  if (typeof value.id !== 'string') return { error: 'JSON: id musi być tekstem' }
  if (!has(HARNESSES, value.harness)) return { error: `JSON: harness spoza listy: ${HARNESSES.join(', ')}` }
  const effort = value.effort === undefined ? 'default' : value.effort
  if (!has(EFFORTS, effort)) return { error: `JSON: effort spoza listy: ${EFFORTS.join(', ')}` }
  const t = value.thinking
  const thinking = t === undefined ? { level: '-', pass: undefined } : typeof t === 'string' ? { level: t, pass: undefined } : isObject(t) ? { level: t.level, pass: t.pass } : { level: t, pass: undefined }
  if (!has(LEVELS, thinking.level)) return { error: `JSON: thinking.level spoza listy: ${LEVELS.join(', ')}` }
  const pass = thinking.pass === undefined ? 'suffix' : thinking.pass
  if (!has(PASSES, pass)) return { error: 'JSON: thinking.pass musi być suffix albo param' }
  return {
    entry: { class: cls as string, id: value.id.trim(), harness: value.harness as string, effort: effort as string, thinking: { level: thinking.level as string, pass: pass as string } },
  }
}

// The whole file: a flat array whose every entry passes parseEntry. The error names the file and, for an entry, its
// 1-based place: `models.json: entry 2: JSON: brak pola id`.
export function parseFile(text: string): { list: Entry[] } | { error: string } {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (err) {
    return { error: `models.json: ${oneLine(String((err as Error)?.message ?? err))}` }
  }
  if (!Array.isArray(value)) return { error: 'models.json: oczekiwana tablica [...]' }
  const list: Entry[] = []
  for (const [i, item] of value.entries()) {
    // A string inside the array is a value of its own, never JSON text to parse again.
    const r = parseEntry(typeof item === 'string' ? JSON.stringify(item) : item)
    if ('error' in r) return { error: `models.json: entry ${i + 1}: ${r.error}` }
    list.push(r.entry)
  }
  return { list }
}

export const serialize = (list: readonly Entry[]): string => `${JSON.stringify(list, null, 2)}\n`

// By class (A, B, C, F), then by id in code-point order. A new array; the input is left as it was.
export function sortEntries(list: readonly Entry[]): Entry[] {
  const rank = (e: Entry) => (CLASSES as readonly string[]).indexOf(e.class)
  return [...list].sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// Another entry (not the one at `exceptIndex`, the edited one) with the same class, id and harness.
export function isDuplicate(list: readonly Entry[], e: Entry, exceptIndex?: number | null): boolean {
  return list.some((x, i) => i !== exceptIndex && x.class === e.class && x.id === e.id && x.harness === e.harness)
}

// The list's thinking cell: `-` is a dash, `off` itself, any other level with how it is passed.
export function thinkingLabel(e: Entry): string {
  const { level, pass } = e.thinking
  if (level === '-') return '—'
  if (level === 'off') return 'off'
  return pass === 'param' ? `${level} (param)` : `${level} (:level)`
}
// The list's effort cell: `none` is a dash.
export const effortLabel = (e: Entry): string => (e.effort === 'none' ? '—' : e.effort)

// A switch's raw value: true for true, 'true' or 'on' (the rule of tools.ts), false for anything else.
export const coerce = (raw: unknown): boolean => raw === true || raw === 'true' || raw === 'on'
// egm_answers: who answers an EGM question of /junkd:task-draft. manual (the default) asks the human; auto lets the
// role answer it and log it. A raw value is trimmed and lowercased; anything else is no answers value.
export const ANSWERS = ['manual', 'auto'] as const
export type Answers = (typeof ANSWERS)[number]
export const coerceAnswers = (raw: unknown): Answers | undefined => {
  const v = String(raw ?? '').trim().toLowerCase()
  return (ANSWERS as readonly string[]).includes(v) ? (v as Answers) : undefined
}

export const newDraft = (): Draft => ({
  mode: 'form',
  entry: { class: 'B', id: '', harness: 'claude', effort: 'default', thinking: { level: '-', pass: 'suffix' } },
  idText: '',
  json: JSON_EXAMPLE,
  editIndex: null,
})
export const editDraft = (entry: Entry, index: number): Draft => ({
  mode: 'form',
  entry: { ...entry, thinking: { ...entry.thinking } },
  idText: entry.id,
  json: JSON.stringify(entry),
  editIndex: index,
})

// The tab's state. `enabled`, `models` and `answers` are the stored egm_* rows; the rest is the view.
export const E = {
  enabled: false,
  models: false,
  answers: 'manual' as Answers,
  view: 'list' as 'list' | 'form' | 'json',
  list: [] as Entry[],
  fileError: undefined as string | undefined,
  sel: 0,
  pendX: null as number | null,
  form: null as Draft | null,
  note: '',
}

// Back to a fresh view: the list, nothing selected past the first row, no draft, no note. The stored rows stay
// (a closed pane does not turn egm off).
export function resetEgm(): void {
  E.view = 'list'
  E.list = []
  E.fileError = undefined
  E.sel = 0
  E.pendX = null
  E.form = null
  E.note = ''
}
